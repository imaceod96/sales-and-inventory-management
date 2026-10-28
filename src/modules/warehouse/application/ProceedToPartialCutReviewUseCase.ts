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
  isEditablePartialCut,
  PARTIAL_CUT_STATUS_LABELS,
  PartialCutProductItem,
  PartialCutStatus,
  PartialInventoryCutRecord,
  reconcilePartialCutItemWithPostMovements,
  resolveCutCommercialActivityProjection,
} from '../domain/entities/InventoryCutRecord';
import { InventoryMovementRecord } from '../domain/entities/InventoryMovementRecord';
import { ProductRecord } from '../domain/entities/ProductRecord';
import { WorkdayRecord, WorkdayStatus } from '../domain/entities/WorkdayRecord';

export class ProceedToPartialCutReviewUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    cutIdOrInput: string | { readonly cutId: string }
  ): Promise<PartialInventoryCutRecord> {
    const cutId =
      typeof cutIdOrInput === 'string' ? cutIdOrInput : cutIdOrInput.cutId;
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'pasar corte parcial a etapa de revisión'
    );

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
        const cut = await tx.get<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          cutId
        );
        if (!cut) {
          throw new EntityNotFoundError('Corte parcial de inventario', cutId);
        }

        if (!isEditablePartialCut(cut.status)) {
          throw new ValidationError(
            `El corte parcial ${cut.reference} está en estado "${PARTIAL_CUT_STATUS_LABELS[cut.status]}" y no puede modificarse.`
          );
        }

        const workday = await tx.get<WorkdayRecord>(
          StoreName.WAREHOUSE_WORKDAYS,
          cut.workdayId
        );
        if (!workday || workday.status !== WorkdayStatus.OPEN) {
          throw new ValidationError(
            'La jornada asociada al corte parcial debe encontrarse en estado Abierta.'
          );
        }

        if (cut.items.length === 0) {
          throw new ValidationError(
            'No se puede pasar a revisión un corte parcial sin productos incluidos.'
          );
        }

        const pendingItems = cut.items.filter(
          (item) => item.countedPhysicalQuantity === null || !item.countedAt
        );
        if (pendingItems.length > 0) {
          throw new ValidationError(
            `No se permite pasar a revisión: aún existen ${pendingItems.length} producto(s) pendiente(s) de conteo físico.`
          );
        }

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

        // Evaluar conciliación de movimientos posteriores y valoración económica para cada partida
        const updatedItems: PartialCutProductItem[] = cut.items.map((item) => {
          const prod = productById.get(item.productId);
          const currentStock = prod ? prod.currentStock : item.theoreticalStockAtCutCreation;
          const reconciliation = reconcilePartialCutItemWithPostMovements(
            item,
            currentStock,
            allMovements,
            cut.cutReferenceTimestamp ?? cut.intervalEndAt,
            cut.id
          );
          const valuation = computeItemDifferenceValuation(
            reconciliation.physicalDifference,
            item.lastPurchasePriceSnapshot ?? (prod?.lastPurchasePrice ?? 0),
            item.salePriceSnapshot ?? (prod?.currentSalePrice ?? 0)
          );

          return {
            ...item,
            captureStatus: reconciliation.requiresRecount ? 'RECOUNT_REQUIRED' : 'COUNTED',
            reconciledTheoreticalStock: reconciliation.reconciledTheoreticalStock,
            differenceQuantity: valuation.differenceQuantity,
            differenceType: valuation.differenceType,
            differenceReason:
              valuation.differenceType === 'NONE' ? null : item.differenceReason ?? null,
            shortagePurchaseValue: valuation.shortagePurchaseValue,
            shortageSaleValue: valuation.shortageSaleValue,
            surplusPurchaseValue: valuation.surplusPurchaseValue,
            surplusSaleValue: valuation.surplusSaleValue,
            netPurchaseImpact: valuation.netPurchaseImpact,
            netSaleImpact: valuation.netSaleImpact,
          };
        });

        const summary = computePartialCutSummaryMetrics(updatedItems);
        const commercialActivity = resolveCutCommercialActivityProjection({
          cut: { ...cut, items: updatedItems },
          allSales,
          allCutsInWorkday,
          workdayOpenedAt: workday.openedAt,
          productsById: productById,
        });

        const timestamp = nowISO();
        const auditId = generateEntityId();
        const recountRequiredCount = updatedItems.filter(
          (i) => i.captureStatus === 'RECOUNT_REQUIRED'
        ).length;

        const auditEntry: OperationLogEntry = {
          id: auditId,
          module: OperationModule.WAREHOUSE,
          action: 'REVIEW_PARTIAL_CUT',
          entityType: 'PartialInventoryCut',
          entityId: cut.id,
          actorRole: actor.role,
          description: `Corte parcial ${cut.reference} pasado a etapa de revisión (${updatedItems.length} productos contados, ${summary.productsWithShortage} con faltante, ${summary.productsWithSurplus} con sobrante, ${recountRequiredCount} con reconteo requerido).`,
          createdAt: timestamp,
        };

        const updatedCut: PartialInventoryCutRecord = {
          ...cut,
          status: PartialCutStatus.READY_FOR_REVIEW,
          statusLabel: PARTIAL_CUT_STATUS_LABELS[PartialCutStatus.READY_FOR_REVIEW],
          items: updatedItems,
          summary,
          commercialActivity,
          readyForReviewAt: timestamp,
          updatedAt: timestamp,
          auditLogIds: [...cut.auditLogIds, auditId],
        };

        await tx.upsert(StoreName.WAREHOUSE_INVENTORY_CUTS, updatedCut);
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return updatedCut;
      }
    );
  }
}

