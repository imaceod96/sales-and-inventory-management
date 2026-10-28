import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { SaleRecord } from '../../sales/domain/entities/SaleRecord';
import {
  computeItemDifferenceValuation,
  computePartialCutSummaryMetrics,
  PARTIAL_CUT_STATUS_LABELS,
  PartialCutProductItem,
  PartialCutStatus,
  PartialInventoryCutRecord,
  reconcilePartialCutItemWithPostMovements,
  resolveCutCommercialActivityProjection,
  roundQuantity,
} from '../domain/entities/InventoryCutRecord';
import {
  InventoryMovementRecord,
  InventoryMovementType,
} from '../domain/entities/InventoryMovementRecord';
import {
  calculateProductAvailability,
  ProductRecord,
} from '../domain/entities/ProductRecord';
import { WorkdayRecord, WorkdayStatus } from '../domain/entities/WorkdayRecord';

export interface ApprovePartialCutInput {
  readonly cutId: string;
  /**
   * Mapa opcional de motivos por productId introducidos en la revisión antes de aprobar.
   * Se combina con cualquier `differenceReason` previamente guardado en cada partida.
   */
  readonly differenceReasons?: Readonly<Record<string, string>>;
  readonly reasonsByProductId?: Readonly<Record<string, string>>;
  readonly notes?: string;
  readonly operationId?: string;
}

export interface ApprovePartialCutResult extends PartialInventoryCutRecord {
  readonly cut: PartialInventoryCutRecord;
  readonly createdMovements: readonly InventoryMovementRecord[];
  readonly updatedProducts: readonly ProductRecord[];
  readonly isDuplicate?: boolean;
}

/**
 * Caso de uso de aprobación definitiva y transaccional de un corte parcial de inventario.
 *
 * Garantiza en una sola transacción IndexedDB:
 * 1. Exclusividad de rol Administrador.
 * 2. Jornada activa en estado OPEN que coincida con el corte.
 * 3. Corte en estado READY_FOR_REVIEW (rechazando cortes DRAFT, CANCELLED o ya APPROVED).
 * 4. Todos los productos en estado COUNTED y ninguno en PENDING ni RECOUNT_REQUIRED.
 * 5. Conciliación en tiempo real de cualquier movimiento ocurrido hasta el instante de aprobación.
 * 6. Motivo obligatorio por cada producto con diferencia física distinta de cero.
 * 7. Aplicación exclusiva de la diferencia aprobada sobre la existencia actual reconciliada,
 *    preservando movimientos válidos posteriores al conteo y prohibiendo existencias negativas.
 * 8. Generación de movimientos compensatorios auditables en el Kardex con trazabilidad completa.
 * 9. Inmutabilidad del corte una vez aprobado.
 */
export class ApprovePartialCutUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: ApprovePartialCutInput
  ): Promise<ApprovePartialCutResult> {
    // 1. Validación estricta de permiso de Administrador
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'aprobar corte parcial de inventario y aplicar ajustes de existencias'
    );

    const cutId = (input.cutId || '').trim();
    if (!cutId) {
      throw new ValidationError('El identificador del corte parcial es obligatorio.');
    }

    const approvedAt = nowISO();
    const auditId = input.operationId || generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_INVENTORY_CUTS,
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.SALES_RECORDS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // 2. Cargar el corte parcial dentro de la transacción
        const cut = await tx.get<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          cutId
        );
        if (!cut) {
          throw new EntityNotFoundError('Corte parcial de inventario', cutId);
        }

        // 3. Idempotencia y bloqueo de doble aprobación o aprobación de cortes cancelados/borradores
        if (cut.status === PartialCutStatus.APPROVED) {
          if (input.operationId && cut.auditLogIds.includes(input.operationId)) {
            const existingMovements = await tx.getAllByIndex<InventoryMovementRecord>(
              StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
              'by_origin_operation_id',
              cut.id
            );
            return {
              ...cut,
              cut,
              createdMovements: existingMovements,
              updatedProducts: [],
              isDuplicate: true,
            };
          }
          throw new ValidationError(
            `El corte parcial ${cut.reference} ya fue aprobado anteriormente y es inmutable.`
          );
        }

        if (cut.status === PartialCutStatus.CANCELLED) {
          throw new ValidationError(
            `No es posible aprobar el corte parcial ${cut.reference} porque se encuentra cancelado.`
          );
        }

        if (cut.status !== PartialCutStatus.READY_FOR_REVIEW) {
          throw new ValidationError(
            `El corte parcial ${cut.reference} debe estar en estado "${PARTIAL_CUT_STATUS_LABELS[PartialCutStatus.READY_FOR_REVIEW]}" antes de aprobarse (estado actual: "${PARTIAL_CUT_STATUS_LABELS[cut.status]}").`
          );
        }

        // 4. Validar jornada activa y coincidente
        const workday = await tx.get<WorkdayRecord>(
          StoreName.WAREHOUSE_WORKDAYS,
          cut.workdayId
        );
        if (!workday) {
          throw new EntityNotFoundError('Jornada de inventario', cut.workdayId);
        }

        if (workday.status !== WorkdayStatus.OPEN) {
          throw new ValidationError(
            `La jornada ${workday.code} asociada al corte parcial no se encuentra Abierta.`
          );
        }

        if (cut.items.length === 0) {
          throw new ValidationError(
            'No se puede aprobar un corte parcial sin productos incluidos.'
          );
        }

        // 5. Cargar productos, movimientos y despachos reales dentro de la transacción
        const [allProducts, allMovements, allSales, allCutsInWorkday] = await Promise.all([
          tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS),
          tx.getAll<InventoryMovementRecord>(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS),
          tx.getAll<SaleRecord>(StoreName.SALES_RECORDS),
          tx.getAllByIndex<PartialInventoryCutRecord>(
            StoreName.WAREHOUSE_INVENTORY_CUTS,
            'by_workday_id',
            workday.id
          ),
        ]);

        const productById = new Map<string, ProductRecord>();
        for (const p of allProducts) {
          productById.set(p.id, p);
        }

        // 6. Verificar estado de captura, conciliación y motivos obligatorios para cada producto
        const preparedApprovals: {
          readonly originalItem: PartialCutProductItem;
          readonly product: ProductRecord;
          readonly reconciledTheoreticalStock: number;
          readonly physicalCountQuantity: number;
          readonly differenceQuantity: number;
          readonly differenceReason: string | null;
          readonly stockBeforeApproval: number;
          readonly stockAfterApproval: number;
          readonly valuation: ReturnType<typeof computeItemDifferenceValuation>;
        }[] = [];

        for (const item of cut.items) {
          if (
            item.captureStatus === 'PENDING' ||
            item.countedPhysicalQuantity === null ||
            !item.countedAt
          ) {
            throw new ValidationError(
              `No se puede aprobar el corte parcial: el producto "${item.productName}" aún está pendiente de conteo físico.`
            );
          }

          if (item.captureStatus === 'RECOUNT_REQUIRED') {
            throw new ValidationError(
              `No se puede aprobar el corte parcial: el producto "${item.productName}" está marcado como «Reconteo requerido».`
            );
          }

          const product = productById.get(item.productId);
          if (!product) {
            throw new EntityNotFoundError('Producto', item.productId);
          }

          const reconciliation = reconcilePartialCutItemWithPostMovements(
            item,
            product.currentStock,
            allMovements,
            cut.cutReferenceTimestamp ?? cut.intervalEndAt,
            cut.id
          );

          if (reconciliation.requiresRecount || reconciliation.physicalDifference === null) {
            throw new ValidationError(
              `No se puede aprobar el corte parcial: el producto "${item.productName}" requiere reconteo obligatorio (${reconciliation.conflictReason || 'movimientos posteriores no conciliables'}).`
            );
          }

          const lastPurchasePriceSnapshot =
            item.lastPurchasePriceSnapshot ?? product.lastPurchasePrice;
          const salePriceSnapshot =
            item.salePriceSnapshot ?? product.currentSalePrice;

          const valuation = computeItemDifferenceValuation(
            reconciliation.physicalDifference,
            lastPurchasePriceSnapshot,
            salePriceSnapshot
          );

          const diffQty = valuation.differenceQuantity ?? 0;
          const rawReason =
            input.differenceReasons?.[item.productId] ??
            input.reasonsByProductId?.[item.productId] ??
            item.differenceReason ??
            '';
          const trimmedReason = rawReason.trim();

          if (valuation.differenceType !== 'NONE' && !trimmedReason) {
            throw new ValidationError(
              `Debes ingresar un motivo obligatorio para justificar la diferencia en el producto "${item.productName}" (${diffQty > 0 ? `+${diffQty}` : diffQty} ${item.unitSymbol}).`
            );
          }

          const stockBeforeApproval = product.currentStock;
          // Regla crítica 9.3: aplicar únicamente la diferencia aprobada sobre la existencia actual reconciliada,
          // preservando cualquier movimiento válido ocurrido después del conteo.
          const stockAfterApproval =
            valuation.differenceType === 'NONE'
              ? stockBeforeApproval
              : roundQuantity(stockBeforeApproval + diffQty);

          if (stockAfterApproval < 0) {
            throw new ValidationError(
              `No es posible aplicar el ajuste por faltante en "${item.productName}" porque dejaría una existencia resultante negativa (${stockAfterApproval} ${item.unitSymbol}). Se requiere reconteo físico.`
            );
          }

          preparedApprovals.push({
            originalItem: item,
            product,
            reconciledTheoreticalStock: reconciliation.reconciledTheoreticalStock,
            physicalCountQuantity: item.countedPhysicalQuantity,
            differenceQuantity: diffQty,
            differenceReason: valuation.differenceType === 'NONE' ? null : trimmedReason,
            stockBeforeApproval,
            stockAfterApproval,
            valuation,
          });
        }

        // 7. Ejecutar ajustes de stock y crear movimientos compensatorios en el Kardex
        const approvedItems: PartialCutProductItem[] = [];
        const createdMovements: InventoryMovementRecord[] = [];
        const updatedProducts: ProductRecord[] = [];
        const generatedMovementIds: string[] = [];

        for (const prep of preparedApprovals) {
          const {
            originalItem,
            product,
            reconciledTheoreticalStock,
            physicalCountQuantity,
            differenceQuantity,
            differenceReason,
            stockBeforeApproval,
            stockAfterApproval,
            valuation,
          } = prep;

          let appliedMovementId: string | null = null;

          if (valuation.differenceType !== 'NONE' && Math.abs(differenceQuantity) >= 0.001) {
            const newAvailability = calculateProductAvailability(
              product.status,
              stockAfterApproval
            );
            const updatedProduct: ProductRecord = {
              ...product,
              currentStock: stockAfterApproval,
              availability: newAvailability,
              updatedAt: approvedAt,
            };
            await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);
            updatedProducts.push(updatedProduct);

            appliedMovementId = generateEntityId();
            generatedMovementIds.push(appliedMovementId);

            const diffLabel =
              differenceQuantity > 0
                ? `Sobrante +${differenceQuantity}`
                : `Faltante ${differenceQuantity}`;

            const movement: InventoryMovementRecord = {
              id: appliedMovementId,
              productId: product.id,
              movementType: InventoryMovementType.PARTIAL_CUT_ADJUSTMENT,
              quantity: differenceQuantity,
              signedQuantity: differenceQuantity,
              previousStock: stockBeforeApproval,
              resultingStock: stockAfterApproval,
              timestamp: approvedAt,
              responsibleUserId: actor.label,
              originOperationId: cut.id,
              workdayId: workday.id,
              workdayFolio: workday.code,
              partialCutId: cut.id,
              partialCutFolio: cut.reference,
              reason: `Ajuste por corte parcial ${cut.reference} (Jornada ${workday.code}) · ${diffLabel} ${originalItem.unitSymbol} · Motivo: ${differenceReason}`,
            };

            await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
            createdMovements.push(movement);
          }

          approvedItems.push({
            ...originalItem,
            captureStatus: 'COUNTED',
            countedPhysicalQuantity: physicalCountQuantity,
            physicalCountQuantity,
            reconciledTheoreticalStock,
            differenceQuantity,
            differenceType: valuation.differenceType,
            differenceReason,
            differencePurchaseValuation: valuation.netPurchaseImpact,
            differenceSaleValuation: valuation.netSaleImpact,
            shortagePurchaseValue: valuation.shortagePurchaseValue,
            shortageSaleValue: valuation.shortageSaleValue,
            surplusPurchaseValue: valuation.surplusPurchaseValue,
            surplusSaleValue: valuation.surplusSaleValue,
            netPurchaseImpact: valuation.netPurchaseImpact,
            netSaleImpact: valuation.netSaleImpact,
            stockBeforeApproval,
            stockAfterApproval,
            appliedAdjustmentMovementId: appliedMovementId,
          });
        }

        const summary = computePartialCutSummaryMetrics(approvedItems);
        const commercialActivity = resolveCutCommercialActivityProjection({
          cut: { ...cut, items: approvedItems },
          allSales,
          allCutsInWorkday,
          workdayOpenedAt: workday.openedAt,
          productsById: productById,
        });

        const auditEntry: OperationLogEntry = {
          id: auditId,
          module: OperationModule.WAREHOUSE,
          action: 'APPROVE_PARTIAL_CUT',
          entityType: 'PartialInventoryCut',
          entityId: cut.id,
          actorRole: actor.role,
          description: `Aprobación definitiva del corte parcial ${cut.reference} (Jornada ${workday.code}): ${summary.totalProductsAudited} auditado(s), ${summary.productsWithoutDifference} sin diferencia, ${summary.productsWithShortage} con faltante, ${summary.productsWithSurplus} con sobrante, ${createdMovements.length} ajuste(s) aplicados al Kardex.`,
          createdAt: approvedAt,
        };

        const approvedCut: PartialInventoryCutRecord = {
          ...cut,
          folio: cut.folio ?? cut.reference,
          workdayFolio: cut.workdayFolio ?? workday.code,
          status: PartialCutStatus.APPROVED,
          statusLabel: PARTIAL_CUT_STATUS_LABELS[PartialCutStatus.APPROVED],
          items: approvedItems,
          summary,
          commercialActivity,
          generatedMovementIds,
          approvedAt,
          approvedByUserId: actor.role,
          approvedByUserRole: actor.role,
          approvedByUserLabel: actor.label,
          closedAt: approvedAt,
          updatedAt: approvedAt,
          notes: input.notes !== undefined ? input.notes.trim() || null : cut.notes,
          auditLogIds: [...cut.auditLogIds, auditId],
        };

        await tx.upsert(StoreName.WAREHOUSE_INVENTORY_CUTS, approvedCut);
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          ...approvedCut,
          cut: approvedCut,
          createdMovements,
          updatedProducts,
        };
      }
    );
  }
}
