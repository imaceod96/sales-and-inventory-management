import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission, hasPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { SaleRecord } from '../../sales/domain/entities/SaleRecord';
import {
  BlindCountProductItemView,
  buildApprovedItemReconciliationResult,
  computeItemDifferenceValuation,
  computePartialCutSummaryMetrics,
  PartialCutCommercialActivitySummary,
  PartialCutItemReconciliationResult,
  PartialCutProductItem,
  PartialCutStatus,
  PartialCutSummaryMetrics,
  PartialInventoryCutRecord,
  reconcilePartialCutItemWithPostMovements,
  resolveCutCommercialActivityProjection,
  sanitizePartialCutForActor,
  sanitizePartialCutSummaryForActor,
  sanitizeReconciliationItemForActor,
  toBlindCountItemView,
} from '../domain/entities/InventoryCutRecord';
import { InventoryMovementRecord } from '../domain/entities/InventoryMovementRecord';
import { ProductRecord } from '../domain/entities/ProductRecord';
import { WorkdayRecord } from '../domain/entities/WorkdayRecord';

export interface PartialCutDetailView {
  readonly cut: PartialInventoryCutRecord;
  /**
   * Vista estricta de conteo ciego: jamás contiene existencias teóricas, diferencias ni costos.
   */
  readonly blindItems: readonly BlindCountProductItemView[];
  /**
   * Vista de revisión y conciliación: disponible para el Administrador cuando todos los
   * productos han sido contados o el corte está en revisión o aprobado.
   */
  readonly reviewItems: readonly PartialCutItemReconciliationResult[];
  readonly reconciledItems: readonly PartialCutItemReconciliationResult[];
  readonly summary: PartialCutSummaryMetrics;
  /**
   * Resumen independiente de la Actividad Comercial del Período (mercancía despachada en el intervalo).
   */
  readonly commercialActivity: PartialCutCommercialActivitySummary;
  readonly totalProductsCount: number;
  readonly countedProductsCount: number;
  readonly pendingProductsCount: number;
  readonly recountRequiredCount: number;
  readonly itemsMissingReasonCount: number;
  readonly canTransitionToReview: boolean;
  readonly canApproveInCurrentBlock: boolean;
  readonly approvalBlockReason: string;
}

export class GetPartialCutDetailUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    cutId: string
  ): Promise<PartialCutDetailView> {
    assertPermission(
      actor,
      Permission.VIEW_INVENTORY_CUTS,
      'consultar detalle de corte parcial'
    );

    const canViewCosts = hasPermission(actor.role, Permission.VIEW_PRODUCT_COSTS);
    const canManageCuts = hasPermission(actor.role, Permission.MANAGE_INVENTORY_CUTS);

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_INVENTORY_CUTS,
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.SALES_RECORDS,
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

        // Si el corte está en borrador o revisión activa, solo el Administrador puede operar sobre él
        if (
          cut.status === PartialCutStatus.DRAFT ||
          cut.status === PartialCutStatus.READY_FOR_REVIEW
        ) {
          assertPermission(
            actor,
            Permission.MANAGE_INVENTORY_CUTS,
            'operar conteo y revisión de corte parcial'
          );
        }

        const [workday, allProducts, allSales, allCutsInWorkday] = await Promise.all([
          tx.get<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS, cut.workdayId),
          tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS),
          tx.getAll<SaleRecord>(StoreName.SALES_RECORDS),
          tx.getAllByIndex<PartialInventoryCutRecord>(
            StoreName.WAREHOUSE_INVENTORY_CUTS,
            'by_workday_id',
            cut.workdayId
          ),
        ]);

        const productById = new Map<string, ProductRecord>();
        for (const p of allProducts) {
          productById.set(p.id, p);
        }

        // Si el corte ya está APROBADO, es estrictamente inmutable y devuelve sus valores congelados
        if (cut.status === PartialCutStatus.APPROVED) {
          const rawApprovedReviewItems = cut.items.map(buildApprovedItemReconciliationResult);
          const rawApprovedSummary =
            cut.summary ?? computePartialCutSummaryMetrics(rawApprovedReviewItems);
          const blindItems = cut.items.map(toBlindCountItemView);

          const commercialActivity = resolveCutCommercialActivityProjection({
            cut,
            allSales,
            allCutsInWorkday,
            workdayOpenedAt: workday?.openedAt,
            productsById: productById,
          });

          const safeCut = sanitizePartialCutForActor(
            cut,
            commercialActivity,
            canViewCosts,
            canManageCuts
          );
          const safeReviewItems = rawApprovedReviewItems.map((item) =>
            sanitizeReconciliationItemForActor(item, canViewCosts, canManageCuts)
          );
          const safeSummary = sanitizePartialCutSummaryForActor(
            rawApprovedSummary,
            canViewCosts,
            canManageCuts
          );

          return {
            cut: safeCut,
            blindItems,
            reviewItems: safeReviewItems,
            reconciledItems: safeReviewItems,
            summary: safeSummary,
            commercialActivity,
            totalProductsCount: cut.items.length,
            countedProductsCount: cut.items.length,
            pendingProductsCount: 0,
            recountRequiredCount: 0,
            itemsMissingReasonCount: 0,
            canTransitionToReview: false,
            canApproveInCurrentBlock: false,
            approvalBlockReason: `El corte parcial ${cut.reference} ya fue aprobado definitivamente y es inmutable.`,
          };
        }

        const allMovements = await tx.getAll<InventoryMovementRecord>(
          StoreName.WAREHOUSE_INVENTORY_MOVEMENTS
        );

        let needsStatusSync = false;
        const syncedItems: PartialCutProductItem[] = [];
        const reviewItems: PartialCutItemReconciliationResult[] = [];

        for (const item of cut.items) {
          const prod = productById.get(item.productId);
          const currentStock = prod ? prod.currentStock : item.theoreticalStockAtCutCreation;
          const reconciliation = reconcilePartialCutItemWithPostMovements(
            item,
            currentStock,
            allMovements,
            cut.cutReferenceTimestamp ?? cut.intervalEndAt,
            cut.id
          );

          reviewItems.push(reconciliation);

          const expectedCaptureStatus =
            item.countedPhysicalQuantity === null
              ? 'PENDING'
              : reconciliation.requiresRecount
                ? 'RECOUNT_REQUIRED'
                : 'COUNTED';

          const valuation = computeItemDifferenceValuation(
            reconciliation.physicalDifference,
            item.lastPurchasePriceSnapshot ?? (prod?.lastPurchasePrice ?? 0),
            item.salePriceSnapshot ?? (prod?.currentSalePrice ?? 0)
          );

          if (
            (cut.status === PartialCutStatus.DRAFT ||
              cut.status === PartialCutStatus.READY_FOR_REVIEW) &&
            (item.captureStatus !== expectedCaptureStatus ||
              item.differenceQuantity !== valuation.differenceQuantity ||
              item.differenceType !== valuation.differenceType)
          ) {
            needsStatusSync = true;
            syncedItems.push({
              ...item,
              captureStatus: expectedCaptureStatus,
              reconciledTheoreticalStock: reconciliation.reconciledTheoreticalStock,
              differenceQuantity: valuation.differenceQuantity,
              differenceType: valuation.differenceType,
              shortagePurchaseValue: valuation.shortagePurchaseValue,
              shortageSaleValue: valuation.shortageSaleValue,
              surplusPurchaseValue: valuation.surplusPurchaseValue,
              surplusSaleValue: valuation.surplusSaleValue,
              netPurchaseImpact: valuation.netPurchaseImpact,
              netSaleImpact: valuation.netSaleImpact,
            });
          } else {
            syncedItems.push(item);
          }
        }

        const summary = computePartialCutSummaryMetrics(reviewItems);
        const commercialActivity = resolveCutCommercialActivityProjection({
          cut: { ...cut, items: syncedItems },
          allSales,
          allCutsInWorkday,
          workdayOpenedAt: workday?.openedAt,
          productsById: productById,
        });

        let effectiveCut: PartialInventoryCutRecord = {
          ...cut,
          items: syncedItems,
          summary,
          commercialActivity,
        };
        if (needsStatusSync) {
          await tx.upsert(StoreName.WAREHOUSE_INVENTORY_CUTS, effectiveCut);
        }

        const blindItems = effectiveCut.items.map(toBlindCountItemView);
        const totalProductsCount = effectiveCut.items.length;
        const pendingProductsCount = effectiveCut.items.filter(
          (i) => i.captureStatus === 'PENDING'
        ).length;
        const recountRequiredCount = effectiveCut.items.filter(
          (i) => i.captureStatus === 'RECOUNT_REQUIRED'
        ).length;
        const countedProductsCount = totalProductsCount - pendingProductsCount;

        const itemsMissingReasonCount = reviewItems.filter(
          (r) => r.requiresDifferenceReason && !r.hasValidDifferenceReason
        ).length;

        const canTransitionToReview =
          totalProductsCount > 0 && pendingProductsCount === 0;

        // En etapa DRAFT no se exponen las diferencias ni valoraciones hasta avanzar a revisión
        const safeReviewItems =
          effectiveCut.status === PartialCutStatus.DRAFT && pendingProductsCount > 0
            ? []
            : reviewItems.map((item) =>
                sanitizeReconciliationItemForActor(item, canViewCosts, canManageCuts)
              );
        const safeReconciledItems =
          effectiveCut.status === PartialCutStatus.DRAFT
            ? []
            : reviewItems.map((item) =>
                sanitizeReconciliationItemForActor(item, canViewCosts, canManageCuts)
              );
        const safeSummary = sanitizePartialCutSummaryForActor(
          summary,
          canViewCosts,
          canManageCuts
        );
        const safeCut = sanitizePartialCutForActor(
          effectiveCut,
          commercialActivity,
          canViewCosts,
          canManageCuts
        );

        const canApproveInCurrentBlock =
          effectiveCut.status === PartialCutStatus.READY_FOR_REVIEW &&
          totalProductsCount > 0 &&
          pendingProductsCount === 0 &&
          recountRequiredCount === 0 &&
          itemsMissingReasonCount === 0;

        let approvalBlockReason = '';
        if (effectiveCut.status === PartialCutStatus.CANCELLED) {
          approvalBlockReason = 'El corte parcial fue cancelado y no puede aprobarse.';
        } else if (totalProductsCount === 0) {
          approvalBlockReason =
            'El corte parcial no contiene productos con actividad comercial para auditar.';
        } else if (pendingProductsCount > 0) {
          approvalBlockReason = `Aún existen ${pendingProductsCount} producto(s) pendiente(s) de conteo físico.`;
        } else if (effectiveCut.status === PartialCutStatus.DRAFT) {
          approvalBlockReason =
            'Avanza el corte a la etapa «Listo para revisión» para revisar las diferencias y aprobarlo.';
        } else if (recountRequiredCount > 0) {
          approvalBlockReason = `Existen ${recountRequiredCount} producto(s) marcados como «Reconteo requerido» por movimientos posteriores que invalidaron el conteo.`;
        } else if (itemsMissingReasonCount > 0) {
          approvalBlockReason = `Debes registrar un motivo obligatorio para los ${itemsMissingReasonCount} producto(s) con diferencia física antes de aprobar el corte.`;
        }

        return {
          cut: safeCut,
          blindItems,
          reviewItems: safeReviewItems,
          reconciledItems: safeReconciledItems,
          summary: safeSummary,
          commercialActivity,
          totalProductsCount,
          countedProductsCount,
          pendingProductsCount,
          recountRequiredCount,
          itemsMissingReasonCount,
          canTransitionToReview,
          canApproveInCurrentBlock,
          approvalBlockReason,
        };
      }
    );
  }
}

