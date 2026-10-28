import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import {
  computeItemDifferenceValuation,
  computePartialCutSummaryMetrics,
  isEditablePartialCut,
  PARTIAL_CUT_STATUS_LABELS,
  PartialCutProductItem,
  PartialInventoryCutRecord,
  PhysicalCountAttemptRecord,
  reconcilePartialCutItemWithPostMovements,
  validatePhysicalCountQuantity,
} from '../domain/entities/InventoryCutRecord';
import { InventoryMovementRecord } from '../domain/entities/InventoryMovementRecord';
import { ProductRecord } from '../domain/entities/ProductRecord';
import { WorkdayRecord, WorkdayStatus } from '../domain/entities/WorkdayRecord';

export interface RecordPartialCutCountInput {
  readonly cutId: string;
  readonly productId: string;
  readonly countedQuantity?: unknown;
  readonly reason?: string;
  readonly differenceReason?: string;
  readonly countedAt?: string;
}

export class RecordPartialCutCountUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: RecordPartialCutCountInput
  ): Promise<PartialInventoryCutRecord> {
    // 1. Validar permisos: solo Administrador
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'registrar conteo físico en corte parcial'
    );

    const isUpdatingReasonOnly =
      input.countedQuantity === undefined && input.differenceReason !== undefined;

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_INVENTORY_CUTS,
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        const cut = await tx.get<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          input.cutId
        );
        if (!cut) {
          throw new EntityNotFoundError('Corte parcial de inventario', input.cutId);
        }

        if (!isEditablePartialCut(cut.status)) {
          throw new ValidationError(
            `El corte parcial ${cut.reference} se encuentra en estado "${PARTIAL_CUT_STATUS_LABELS[cut.status]}" y no permite modificar conteos ni motivos.`
          );
        }

        const workday = await tx.get<WorkdayRecord>(
          StoreName.WAREHOUSE_WORKDAYS,
          cut.workdayId
        );
        if (!workday || workday.status !== WorkdayStatus.OPEN) {
          throw new ValidationError(
            'La jornada asociada al corte parcial no se encuentra en estado Abierta.'
          );
        }

        const itemIndex = cut.items.findIndex((i) => i.productId === input.productId);
        if (itemIndex === -1) {
          throw new ValidationError(
            'El producto especificado no forma parte de este corte parcial.'
          );
        }

        const existingItem = cut.items[itemIndex];
        const validatedQuantity = isUpdatingReasonOnly
          ? null
          : validatePhysicalCountQuantity(input.countedQuantity, existingItem.unitName);

        const product = await tx.get<ProductRecord>(
          StoreName.WAREHOUSE_PRODUCTS,
          input.productId
        );
        if (!product) {
          throw new EntityNotFoundError('Producto', input.productId);
        }

        const allMovements = await tx.getAll<InventoryMovementRecord>(
          StoreName.WAREHOUSE_INVENTORY_MOVEMENTS
        );

        const currentItem = cut.items[itemIndex];
        const timestamp = input.countedAt ?? nowISO();

        if (isUpdatingReasonOnly) {
          const trimmedDiffReason = input.differenceReason?.trim() || null;
          const updatedItem: PartialCutProductItem = {
            ...currentItem,
            differenceReason: trimmedDiffReason,
          };
          const updatedItems = cut.items.map((item, idx) =>
            idx === itemIndex ? updatedItem : item
          );
          const updatedCut: PartialInventoryCutRecord = {
            ...cut,
            items: updatedItems,
            summary: computePartialCutSummaryMetrics(updatedItems),
            updatedAt: timestamp,
          };
          await tx.upsert(StoreName.WAREHOUSE_INVENTORY_CUTS, updatedCut);
          return updatedCut;
        }

        const countedQty = validatedQuantity!;
        const isRecount = currentItem.countedPhysicalQuantity !== null;
        const noteText =
          input.reason?.trim() ||
          (isRecount ? 'Reconteo / actualización de captura' : 'Captura inicial ciega');

        const attemptRecord: PhysicalCountAttemptRecord = {
          attemptNumber: currentItem.countHistory.length + 1,
          countedQuantity: countedQty,
          countedAt: timestamp,
          countedByUserId: actor.role,
          countedByUserRole: actor.role,
          theoreticalStockAtCountTime: product.currentStock,
          previousQuantity: currentItem.countedPhysicalQuantity,
          reason: noteText,
          note: noteText,
        };

        const candidateItem: PartialCutProductItem = {
          ...currentItem,
          captureStatus: 'COUNTED',
          countedPhysicalQuantity: countedQty,
          physicalCountQuantity: countedQty,
          countedAt: timestamp,
          countedByUserId: actor.role,
          theoreticalStockAtCountTime: product.currentStock,
          reconciledTheoreticalStock: product.currentStock,
          differenceReason:
            input.differenceReason !== undefined
              ? input.differenceReason.trim() || null
              : currentItem.differenceReason ?? null,
          countHistory: [...currentItem.countHistory, attemptRecord],
        };

        const reconciliation = reconcilePartialCutItemWithPostMovements(
          candidateItem,
          product.currentStock,
          allMovements,
          cut.cutReferenceTimestamp ?? cut.intervalEndAt,
          cut.id
        );

        const valuation = computeItemDifferenceValuation(
          reconciliation.physicalDifference,
          candidateItem.lastPurchasePriceSnapshot,
          candidateItem.salePriceSnapshot
        );

        const resolvedDiffReason =
          valuation.differenceType === 'NONE'
            ? null
            : input.differenceReason !== undefined
              ? input.differenceReason.trim() || null
              : currentItem.differenceReason ?? null;

        const updatedItem: PartialCutProductItem = {
          ...candidateItem,
          captureStatus: reconciliation.requiresRecount ? 'RECOUNT_REQUIRED' : 'COUNTED',
          reconciledTheoreticalStock: reconciliation.reconciledTheoreticalStock,
          differenceQuantity: valuation.differenceQuantity,
          differenceType: valuation.differenceType,
          differenceReason: resolvedDiffReason,
          shortagePurchaseValue: valuation.shortagePurchaseValue,
          shortageSaleValue: valuation.shortageSaleValue,
          surplusPurchaseValue: valuation.surplusPurchaseValue,
          surplusSaleValue: valuation.surplusSaleValue,
          netPurchaseImpact: valuation.netPurchaseImpact,
          netSaleImpact: valuation.netSaleImpact,
        };

        const updatedItems = cut.items.map((item, idx) =>
          idx === itemIndex ? updatedItem : item
        );

        const auditId = generateEntityId();
        const auditEntry: OperationLogEntry = {
          id: auditId,
          module: OperationModule.WAREHOUSE,
          action: isRecount ? 'RECOUNT_PARTIAL_CUT_ITEM' : 'RECORD_PARTIAL_CUT_COUNT',
          entityType: 'PartialInventoryCut',
          entityId: cut.id,
          actorRole: actor.role,
          description: isRecount
            ? `Reconteo registrado en corte ${cut.reference} para "${currentItem.productName}" (intento #${attemptRecord.attemptNumber}, cantidad previa: ${currentItem.countedPhysicalQuantity}, nueva cantidad: ${countedQty}).`
            : `Conteo ciego capturado en corte ${cut.reference} para "${currentItem.productName}" (cantidad física: ${countedQty}).`,
          createdAt: timestamp,
        };

        const updatedCut: PartialInventoryCutRecord = {
          ...cut,
          items: updatedItems,
          summary: computePartialCutSummaryMetrics(updatedItems),
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
