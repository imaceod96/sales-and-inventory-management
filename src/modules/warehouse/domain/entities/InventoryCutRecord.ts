import { BaseEntity, EntityId, ISODateString } from '../../../../shared/types/entity';
import { ValidationError } from '../../../../shared/types/errors';
import { SaleRecord, SaleStatus } from '../../../sales/domain/entities/SaleRecord';
import { InventoryMovementRecord, InventoryMovementType } from './InventoryMovementRecord';
import { ProductRecord, ProductStatus } from './ProductRecord';
import { ProductStatusChangeRecord } from './ProductStatusChangeRecord';

/**
 * Estados del ciclo de vida de un corte parcial de inventario.
 */
export enum PartialCutStatus {
  DRAFT = 'DRAFT',
  READY_FOR_REVIEW = 'READY_FOR_REVIEW',
  APPROVED = 'APPROVED',
  CANCELLED = 'CANCELLED',
}

export const PARTIAL_CUT_STATUS_LABELS: Record<PartialCutStatus, string> = {
  [PartialCutStatus.DRAFT]: 'Borrador / En conteo',
  [PartialCutStatus.READY_FOR_REVIEW]: 'Listo para revisión',
  [PartialCutStatus.APPROVED]: 'Aprobado',
  [PartialCutStatus.CANCELLED]: 'Cancelado',
};

/**
 * Estado de captura física individual de un producto dentro del corte parcial.
 */
export type PartialCutCaptureStatus = 'PENDING' | 'COUNTED' | 'RECOUNT_REQUIRED';

export const PARTIAL_CUT_CAPTURE_STATUS_LABELS: Record<PartialCutCaptureStatus, string> = {
  PENDING: 'Pendiente',
  COUNTED: 'Contado',
  RECOUNT_REQUIRED: 'Reconteo requerido',
};

/**
 * Clasificación de la diferencia física de un producto en el corte parcial.
 */
export type PartialCutDifferenceType = 'NONE' | 'SHORTAGE' | 'SURPLUS';

export const PARTIAL_CUT_DIFFERENCE_TYPE_LABELS: Record<PartialCutDifferenceType, string> = {
  NONE: 'SIN DIFERENCIA',
  SHORTAGE: 'FALTANTE',
  SURPLUS: 'SOBRANTE',
};

/**
 * Origen de la selección de productos incluidos en el corte parcial.
 * La selección es estrictamente automática basada en operaciones comerciales reales;
 * nunca se permite la selección manual por parte del Administrador.
 */
export type PartialCutSelectionSource =
  | 'CONFIRMED_COMMERCIAL_OPERATIONS'
  | 'AUTOMATIC_WITHOUT_COMMERCIAL_ACTIVITY';

/**
 * Registro histórico inmutable de cada captura o reconteo físico de un producto dentro de un corte.
 */
export interface PhysicalCountAttemptRecord {
  readonly attemptNumber: number;
  readonly countedQuantity: number;
  readonly countedAt: ISODateString;
  readonly countedByUserId: string;
  readonly countedByUserRole?: string;
  readonly theoreticalStockAtCountTime: number;
  readonly previousQuantity: number | null;
  readonly reason?: string | null;
  readonly note?: string | null;
}

/**
 * Partida de producto incluida automáticamente dentro de un corte parcial.
 */
export interface PartialCutProductItem {
  readonly productId: EntityId;
  readonly productName: string;
  readonly productCode: string;
  readonly sku: string | null;
  readonly categoryId: EntityId;
  readonly categoryName: string;
  readonly measurementUnitId: EntityId;
  readonly unitName: string;
  readonly unitSymbol: string;
  readonly measurementUnitName?: string;
  readonly unitOfMeasureLabel?: string;
  readonly productStatusAtCutCreation?: ProductStatus;
  readonly productStatusAtCutReference?: ProductStatus;
  readonly isCurrentlyActive?: boolean;
  readonly currentAvailability?: string;
  readonly lastPurchasePriceSnapshot: number;
  readonly salePriceSnapshot: number;
  readonly theoreticalStockAtCutCreation: number;
  readonly theoreticalStockAtCutReference: number;
  readonly theoreticalStockAtCutEnd?: number;
  readonly reconciledTheoreticalStock: number | null;
  readonly lastMovementIdAtCreation: EntityId | null;
  readonly captureStatus: PartialCutCaptureStatus;
  readonly countedPhysicalQuantity: number | null;
  readonly physicalCountQuantity: number | null;
  readonly countedAt: ISODateString | null;
  readonly countedByUserId: string | null;
  readonly theoreticalStockAtCountTime: number | null;
  readonly differenceQuantity: number | null;
  readonly differenceType: PartialCutDifferenceType | null;
  readonly differenceReason: string | null;
  readonly differencePurchaseValuation?: number;
  readonly differenceSaleValuation?: number;
  readonly shortagePurchaseValue: number;
  readonly shortageSaleValue: number;
  readonly surplusPurchaseValue: number;
  readonly surplusSaleValue: number;
  readonly netPurchaseImpact: number;
  readonly netSaleImpact: number;
  readonly stockBeforeApproval?: number | null;
  readonly stockAfterApproval?: number | null;
  readonly appliedAdjustmentMovementId?: EntityId | null;
  readonly countHistory: readonly PhysicalCountAttemptRecord[];
  readonly commercialActivityRefIds: readonly string[];
  readonly salesCountInInterval?: number;
  readonly inclusionOrigin: 'COMMERCIAL_OPERATION';
}

/**
 * Resumen económico y operativo consolidado del corte parcial (Balance económico del inventario).
 * Regla: No se suman cantidades físicas de productos con distintas unidades de medida.
 */
export interface PartialCutSummaryMetrics {
  readonly totalProductsAudited: number;
  readonly productsWithoutDifference: number;
  readonly productsWithShortage: number;
  readonly productsWithSurplus: number;
  readonly totalShortagePurchaseValue: number;
  readonly totalShortageSaleValue: number;
  readonly totalSurplusPurchaseValue: number;
  readonly totalSurplusSaleValue: number;
  readonly netPurchaseBalance: number;
  readonly netSaleBalance: number;
}

/**
 * Desglose consolidado por producto de la mercancía efectivamente despachada
 * durante el intervalo de un corte parcial.
 *
 * Reglas de dominio:
 * - Solo incluye despachos reales confirmados (DISPATCHED) dentro del intervalo del corte.
 * - Si un producto se despachó varias veces, consolida sus cantidades e importes.
 * - Si el precio de venta cambió durante el intervalo, el importe total es la suma exacta
 *   de (cantidad × precio histórico congelado en cada despacho), nunca cantidad total × precio único.
 */
export interface PartialCutCommercialProductBreakdownItem {
  readonly productId: EntityId;
  readonly productCode: string;
  readonly sku: string | null;
  readonly productName: string;
  readonly measurementUnitId: EntityId;
  readonly unitName: string;
  readonly unitSymbol: string;
  readonly dispatchedQuantity: number;
  readonly dispatchCount: number;
  readonly dispatchFolios: readonly string[];
  readonly distinctHistoricalUnitPrices: readonly number[];
  readonly totalCommercialAmount: number;
}

/**
 * Resumen consolidado de la Actividad Comercial del Período para un corte parcial.
 * Representa exclusivamente el valor de la mercancía despachada en el intervalo,
 * nunca dinero cobrado ni balance de diferencias físicas de inventario.
 */
export interface PartialCutCommercialActivitySummary {
  readonly workdayId: EntityId;
  readonly intervalStartAt: ISODateString;
  readonly intervalEndAt: ISODateString;
  readonly isInitialWorkdayInterval: boolean;
  readonly totalDispatchesCount: number;
  readonly distinctProductsCount: number;
  /**
   * Indica si todos los productos despachados en el intervalo comparten una misma
   * unidad de medida comparable. Nunca se suman cantidades físicas de unidades incompatibles.
   */
  readonly areUnitsComparable: boolean;
  readonly comparableTotalQuantity: number | null;
  readonly comparableUnitName: string | null;
  readonly comparableUnitSymbol: string | null;
  readonly totalCommercialValue: number;
  readonly productBreakdown: readonly PartialCutCommercialProductBreakdownItem[];
  readonly dispatchIds: readonly EntityId[];
  readonly dispatchFolios: readonly string[];
  readonly hasInsufficientHistoricalData?: boolean;
  readonly historicalDataNotice?: string | null;
}

/**
 * Vista segura para Conteo Ciego: omite deliberadamente existencias teóricas, diferencias y costos.
 */
export interface BlindCountProductItemView {
  readonly productId: EntityId;
  readonly productName: string;
  readonly productCode: string;
  readonly sku: string | null;
  readonly categoryName: string;
  readonly unitName: string;
  readonly unitSymbol: string;
  readonly captureStatus: PartialCutCaptureStatus;
  readonly countedPhysicalQuantity: number | null;
  readonly countedAt: ISODateString | null;
  readonly attemptCount: number;
}

/**
 * Resultado de conciliación de movimientos posteriores para un producto del corte parcial.
 */
export type ItemReconciliationStatus =
  | 'PENDING_COUNT'
  | 'CLEAN'
  | 'RECONCILED_POST_MOVEMENTS'
  | 'RECOUNT_REQUIRED';

export interface ReconciledPostMovementItem {
  readonly movementId: EntityId;
  readonly movementType: InventoryMovementType;
  readonly quantity: number;
  readonly signedDelta: number;
  readonly previousStock: number;
  readonly resultingStock: number;
  readonly timestamp: ISODateString;
  readonly reason?: string | null;
}

export interface PartialCutItemReconciliationResult {
  readonly item: PartialCutProductItem;
  readonly productId: EntityId;
  readonly productName: string;
  readonly productCode: string;
  readonly sku: string | null;
  readonly categoryName: string;
  readonly unitName: string;
  readonly unitSymbol: string;
  readonly captureStatus: PartialCutCaptureStatus;
  readonly reconciliationStatus: ItemReconciliationStatus;
  readonly requiresRecount: boolean;
  readonly conflictReason: string | null;
  readonly theoreticalStockAtCutReference: number;
  readonly theoreticalStockAtReference: number;
  readonly reconciledStockAtCount: number;
  readonly reconciledTheoreticalStock: number;
  readonly currentSystemStock: number;
  readonly countedPhysicalQuantity: number | null;
  readonly physicalCountQuantity: number | null;
  readonly countedAt: ISODateString | null;
  readonly preCountDelta: number;
  readonly preCountMovements: readonly ReconciledPostMovementItem[];
  readonly netPostCountDelta: number;
  readonly adjustedPhysicalQuantityAtReview: number | null;
  readonly physicalDifference: number | null;
  readonly differenceQuantity: number | null;
  readonly differenceFromReconciled: number | null;
  readonly differenceType: PartialCutDifferenceType | null;
  readonly differenceReason: string | null;
  readonly requiresDifferenceReason: boolean;
  readonly hasValidDifferenceReason: boolean;
  readonly lastPurchasePriceSnapshot: number;
  readonly salePriceSnapshot: number;
  readonly shortagePurchaseValue: number;
  readonly shortageSaleValue: number;
  readonly surplusPurchaseValue: number;
  readonly surplusSaleValue: number;
  readonly netPurchaseImpact: number;
  readonly netSaleImpact: number;
  readonly differencePurchaseValuation: number;
  readonly differenceSaleValuation: number;
  readonly stockBeforeApproval?: number | null;
  readonly stockAfterApproval?: number | null;
  readonly appliedAdjustmentMovementId?: EntityId | null;
  readonly postCountMovements: readonly ReconciledPostMovementItem[];
  readonly countHistory: readonly PhysicalCountAttemptRecord[];
}

export interface InventoryCutBaseRecord extends BaseEntity {
  readonly reference: string;
  readonly openedAt: ISODateString;
  readonly closedAt: ISODateString | null;
  readonly statusLabel: string;
}

/**
 * Entidad completa de Corte Parcial de Inventario vinculada obligatoriamente a una jornada.
 */
export interface PartialInventoryCutRecord extends InventoryCutBaseRecord {
  readonly folio: string;
  readonly workdayId: EntityId;
  readonly workdayCode: string;
  readonly workdayFolio?: string;
  readonly consecutiveNumber: number;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  readonly intervalStartAt: ISODateString;
  readonly intervalEndAt: ISODateString;
  readonly intervalStartTimestamp: ISODateString;
  readonly intervalEndTimestamp: ISODateString;
  readonly cutReferenceTimestamp: ISODateString;
  readonly responsibleUserId: string;
  readonly responsibleUserLabel: string;
  readonly createdByUserId?: string;
  readonly createdByUserRole?: string;
  readonly status: PartialCutStatus;
  readonly selectionSource: PartialCutSelectionSource;
  readonly hasGuaranteedSalesCoverage: boolean;
  readonly salesModuleDependencyNotice: string;
  readonly items: readonly PartialCutProductItem[];
  readonly summary?: PartialCutSummaryMetrics;
  readonly commercialActivity?: PartialCutCommercialActivitySummary;
  readonly generatedMovementIds?: readonly EntityId[];
  readonly readyForReviewAt?: ISODateString | null;
  readonly cancelledAt?: ISODateString | null;
  readonly cancelledByUserId?: string | null;
  readonly cancelledByUserRole?: string | null;
  readonly cancelledByUserLabel?: string | null;
  readonly cancellationReason?: string | null;
  readonly approvedAt?: ISODateString | null;
  readonly approvedByUserId?: string | null;
  readonly approvedByUserRole?: string | null;
  readonly approvedByUserLabel?: string | null;
  readonly notes?: string | null;
  readonly auditLogIds: readonly EntityId[];
}

export function roundQuantity(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Determina el impacto con signo de un movimiento de inventario sobre el stock.
 */
export function getSignedMovementDelta(mov: InventoryMovementRecord): number {
  if (typeof mov.signedQuantity === 'number' && Number.isFinite(mov.signedQuantity)) {
    return roundQuantity(mov.signedQuantity);
  }
  if (
    mov.movementType === InventoryMovementType.SALE ||
    mov.movementType === InventoryMovementType.CORRECTION_NEGATIVE
  ) {
    return roundQuantity(-Math.abs(mov.quantity));
  }
  if (
    mov.movementType === InventoryMovementType.ENTRY ||
    mov.movementType === InventoryMovementType.CORRECTION_POSITIVE
  ) {
    return roundQuantity(Math.abs(mov.quantity));
  }
  if (mov.movementType === InventoryMovementType.PARTIAL_CUT_ADJUSTMENT) {
    if (mov.quantity < 0) return roundQuantity(mov.quantity);
    if (mov.resultingStock < mov.previousStock) return roundQuantity(-Math.abs(mov.quantity));
    return roundQuantity(mov.quantity);
  }
  return roundQuantity(mov.resultingStock - mov.previousStock);
}

/**
 * Clasifica la diferencia física y calcula su valoración económica congelada a precio de compra y venta.
 */
export interface ItemDifferenceValuation {
  readonly differenceQuantity: number | null;
  readonly differenceType: PartialCutDifferenceType | null;
  readonly shortagePurchaseValue: number;
  readonly shortageSaleValue: number;
  readonly surplusPurchaseValue: number;
  readonly surplusSaleValue: number;
  readonly netPurchaseImpact: number;
  readonly netSaleImpact: number;
}

export function computeItemDifferenceValuation(
  physicalDifference: number | null,
  lastPurchasePriceSnapshot: number,
  salePriceSnapshot: number
): ItemDifferenceValuation {
  const safePurchase = Number.isFinite(lastPurchasePriceSnapshot) ? lastPurchasePriceSnapshot : 0;
  const safeSale = Number.isFinite(salePriceSnapshot) ? salePriceSnapshot : 0;

  if (physicalDifference === null || !Number.isFinite(physicalDifference)) {
    return {
      differenceQuantity: null,
      differenceType: null,
      shortagePurchaseValue: 0,
      shortageSaleValue: 0,
      surplusPurchaseValue: 0,
      surplusSaleValue: 0,
      netPurchaseImpact: 0,
      netSaleImpact: 0,
    };
  }

  const normalizedDiff = roundQuantity(physicalDifference);
  if (Math.abs(normalizedDiff) < 0.001) {
    return {
      differenceQuantity: 0,
      differenceType: 'NONE',
      shortagePurchaseValue: 0,
      shortageSaleValue: 0,
      surplusPurchaseValue: 0,
      surplusSaleValue: 0,
      netPurchaseImpact: 0,
      netSaleImpact: 0,
    };
  }

  const absDiff = Math.abs(normalizedDiff);
  if (normalizedDiff < 0) {
    const shortagePurchaseValue = roundMoney(absDiff * safePurchase);
    const shortageSaleValue = roundMoney(absDiff * safeSale);
    return {
      differenceQuantity: normalizedDiff,
      differenceType: 'SHORTAGE',
      shortagePurchaseValue,
      shortageSaleValue,
      surplusPurchaseValue: 0,
      surplusSaleValue: 0,
      netPurchaseImpact: roundMoney(-shortagePurchaseValue),
      netSaleImpact: roundMoney(-shortageSaleValue),
    };
  }

  const surplusPurchaseValue = roundMoney(absDiff * safePurchase);
  const surplusSaleValue = roundMoney(absDiff * safeSale);
  return {
    differenceQuantity: normalizedDiff,
    differenceType: 'SURPLUS',
    shortagePurchaseValue: 0,
    shortageSaleValue: 0,
    surplusPurchaseValue,
    surplusSaleValue,
    netPurchaseImpact: surplusPurchaseValue,
    netSaleImpact: surplusSaleValue,
  };
}

/**
 * Calcula las métricas consolidadas económicas y operativas del corte parcial.
 * Nunca suma cantidades físicas entre productos con distintas unidades de medida.
 */
export function computePartialCutSummaryMetrics(
  items: readonly {
    readonly differenceType: PartialCutDifferenceType | null;
    readonly shortagePurchaseValue: number;
    readonly shortageSaleValue: number;
    readonly surplusPurchaseValue: number;
    readonly surplusSaleValue: number;
  }[]
): PartialCutSummaryMetrics {
  let productsWithoutDifference = 0;
  let productsWithShortage = 0;
  let productsWithSurplus = 0;
  let totalShortagePurchaseValue = 0;
  let totalShortageSaleValue = 0;
  let totalSurplusPurchaseValue = 0;
  let totalSurplusSaleValue = 0;

  for (const item of items) {
    if (item.differenceType === 'NONE') {
      productsWithoutDifference += 1;
    } else if (item.differenceType === 'SHORTAGE') {
      productsWithShortage += 1;
      totalShortagePurchaseValue = roundMoney(
        totalShortagePurchaseValue + (item.shortagePurchaseValue || 0)
      );
      totalShortageSaleValue = roundMoney(
        totalShortageSaleValue + (item.shortageSaleValue || 0)
      );
    } else if (item.differenceType === 'SURPLUS') {
      productsWithSurplus += 1;
      totalSurplusPurchaseValue = roundMoney(
        totalSurplusPurchaseValue + (item.surplusPurchaseValue || 0)
      );
      totalSurplusSaleValue = roundMoney(
        totalSurplusSaleValue + (item.surplusSaleValue || 0)
      );
    }
  }

  return {
    totalProductsAudited: items.length,
    productsWithoutDifference,
    productsWithShortage,
    productsWithSurplus,
    totalShortagePurchaseValue,
    totalShortageSaleValue,
    totalSurplusPurchaseValue,
    totalSurplusSaleValue,
    netPurchaseBalance: roundMoney(totalSurplusPurchaseValue - totalShortagePurchaseValue),
    netSaleBalance: roundMoney(totalSurplusSaleValue - totalShortageSaleValue),
  };
}

export interface ComputeCommercialActivityParams {
  readonly workdayId: EntityId;
  readonly intervalStartAt: ISODateString;
  readonly intervalEndAt: ISODateString;
  readonly sales: readonly SaleRecord[];
  readonly isInitialWorkdayInterval?: boolean;
  readonly priorApprovedCutEndTimestamps?: readonly ISODateString[];
  readonly expectedOperationRefs?: readonly string[];
  readonly fallbackCutItems?: readonly PartialCutProductItem[];
  readonly productsById?: ReadonlyMap<string, ProductRecord>;
  readonly unitsById?: ReadonlyMap<string, { readonly id: string; readonly name: string }>;
}

/**
 * Calcula de forma determinista el resumen de Actividad Comercial del Período y su desglose por producto
 * a partir exclusivamente de los despachos efectivos (DISPATCHED) registrados dentro del intervalo del corte.
 *
 * Reglas de dominio:
 * - Usa exclusivamente `dispatchedAt` (jamás `openedAt` de cuentas abiertas).
 * - Excluye cuentas OPEN, cuentas CANCELLED sin despacho y movimientos administrativos.
 * - Cada despacho se contabiliza una sola vez (deduplicado por id).
 * - Utiliza precios históricos congelados en cada despacho (`line.unitSalePrice`), jamás el precio actual del catálogo ni costos de compra.
 * - Si un producto se despachó varias veces con distintos precios históricos, suma el importe real de cada línea.
 * - Evalúa si las unidades de medida de los productos despachados son comparables antes de sumar cantidades físicas.
 */
export function computeCommercialActivitySummaryFromSales(
  params: ComputeCommercialActivityParams
): PartialCutCommercialActivitySummary {
  const {
    workdayId,
    intervalStartAt,
    intervalEndAt,
    sales,
    isInitialWorkdayInterval = true,
    priorApprovedCutEndTimestamps = [],
    expectedOperationRefs = [],
    fallbackCutItems = [],
    productsById,
    unitsById,
  } = params;

  const hasPriorCutAtBoundary = priorApprovedCutEndTimestamps.some(
    (endTs) => endTs === intervalStartAt
  );
  const effectiveIsInitialInterval = hasPriorCutAtBoundary ? false : isInitialWorkdayInterval;

  const fallbackItemMap = new Map<string, PartialCutProductItem>();
  for (const item of fallbackCutItems) {
    fallbackItemMap.set(item.productId, item);
  }

  const seenSaleIds = new Set<string>();
  const validDispatches: SaleRecord[] = [];
  const allKnownValidOperationRefsInInterval = new Set<string>();

  for (const sale of sales) {
    if (!sale || !sale.id || seenSaleIds.has(sale.id)) {
      continue;
    }

    const effectiveWorkdayId = sale.dispatchedWorkdayId ?? sale.workdayId;
    if (effectiveWorkdayId && effectiveWorkdayId !== workdayId) {
      continue;
    }

    const isDispatched =
      sale.status === SaleStatus.DISPATCHED || (sale.status as string) === 'COMPLETED';
    const isCancelledWithStockReturn =
      sale.status === SaleStatus.CANCELLED && sale.hasStockMovement === true;

    if (isCancelledWithStockReturn) {
      const cancelTime = sale.cancelledAt ?? sale.closedAt ?? sale.updatedAt;
      if (cancelTime) {
        const afterStart = effectiveIsInitialInterval
          ? cancelTime >= intervalStartAt
          : cancelTime > intervalStartAt;
        if (afterStart && cancelTime <= intervalEndAt) {
          allKnownValidOperationRefsInInterval.add(sale.id);
          if (sale.folio) allKnownValidOperationRefsInInterval.add(sale.folio);
        }
      }
      continue;
    }

    if (!isDispatched) {
      continue;
    }

    // Usar exclusivamente la marca temporal real de despacho, jamás `openedAt`
    const dispatchedAt = sale.dispatchedAt ?? sale.closedAt ?? null;
    if (!dispatchedAt) {
      continue;
    }

    const afterStart = effectiveIsInitialInterval
      ? dispatchedAt >= intervalStartAt
      : dispatchedAt > intervalStartAt;
    const beforeOrAtEnd = dispatchedAt <= intervalEndAt;

    if (!afterStart || !beforeOrAtEnd) {
      continue;
    }

    seenSaleIds.add(sale.id);
    validDispatches.push(sale);
    allKnownValidOperationRefsInInterval.add(sale.id);
    if (sale.folio) {
      allKnownValidOperationRefsInInterval.add(sale.folio);
    }
  }

  validDispatches.sort((a, b) =>
    (a.dispatchedAt ?? a.closedAt ?? '').localeCompare(b.dispatchedAt ?? b.closedAt ?? '')
  );

  const productAccumulator = new Map<
    EntityId,
    {
      productId: EntityId;
      productCode: string;
      sku: string | null;
      productName: string;
      measurementUnitId: EntityId;
      unitName: string;
      unitSymbol: string;
      dispatchedQuantity: number;
      dispatchIds: Set<string>;
      dispatchFolios: Set<string>;
      distinctPrices: Set<number>;
      totalCommercialAmount: number;
    }
  >();

  const countedDispatchIds: string[] = [];
  const countedDispatchFolios: string[] = [];
  let totalCommercialValue = 0;
  let hasMissingPriceData = false;

  for (const sale of validDispatches) {
    const rawLines =
      Array.isArray(sale.items)
        ? sale.items
        : Array.isArray((sale as unknown as { lines?: unknown[] }).lines)
          ? ((sale as unknown as { lines: SaleRecord['items'] }).lines ?? [])
          : [];

    let saleHasValidLine = false;

    for (const line of rawLines) {
      if (
        !line ||
        !line.productId ||
        typeof line.quantity !== 'number' ||
        !Number.isFinite(line.quantity) ||
        line.quantity <= 0
      ) {
        continue;
      }

      saleHasValidLine = true;
      const qty = roundQuantity(line.quantity);

      let unitPrice: number | null = null;
      let lineAmount = 0;

      if (
        typeof line.unitSalePrice === 'number' &&
        Number.isFinite(line.unitSalePrice) &&
        line.unitSalePrice >= 0
      ) {
        unitPrice = roundMoney(line.unitSalePrice);
        lineAmount = roundMoney(qty * unitPrice);
      } else if (
        typeof line.lineSubtotal === 'number' &&
        Number.isFinite(line.lineSubtotal) &&
        line.lineSubtotal >= 0
      ) {
        lineAmount = roundMoney(line.lineSubtotal);
        unitPrice = qty > 0 ? roundMoney(lineAmount / qty) : 0;
      } else {
        hasMissingPriceData = true;
      }

      const fallbackItem = fallbackItemMap.get(line.productId);
      const catalogProd = productsById?.get(line.productId);
      const resolvedUnitId =
        line.measurementUnitId ||
        fallbackItem?.measurementUnitId ||
        catalogProd?.measurementUnitId ||
        '';
      const catalogUnit = resolvedUnitId ? unitsById?.get(resolvedUnitId) : undefined;

      const resolvedName =
        line.productName ||
        fallbackItem?.productName ||
        catalogProd?.name ||
        'Producto despachado';
      const resolvedSku =
        line.sku !== undefined
          ? line.sku
          : fallbackItem?.sku !== undefined
            ? fallbackItem.sku
            : (catalogProd?.sku ?? null);
      const resolvedCode =
        line.productCode ||
        fallbackItem?.productCode ||
        resolvedSku ||
        `PRD-${line.productId.slice(0, 8).toUpperCase()}`;
      const resolvedUnitName =
        line.unitName || fallbackItem?.unitName || catalogUnit?.name || 'Unidad';
      const resolvedUnitSymbol =
        line.unitSymbol || fallbackItem?.unitSymbol || catalogUnit?.name || resolvedUnitName;

      const existing = productAccumulator.get(line.productId);
      if (!existing) {
        const dispatchIds = new Set<string>([sale.id]);
        const dispatchFolios = new Set<string>([sale.folio || sale.id]);
        const distinctPrices = new Set<number>();
        if (unitPrice !== null) {
          distinctPrices.add(unitPrice);
        }

        productAccumulator.set(line.productId, {
          productId: line.productId,
          productCode: resolvedCode,
          sku: resolvedSku,
          productName: resolvedName,
          measurementUnitId: resolvedUnitId,
          unitName: resolvedUnitName,
          unitSymbol: resolvedUnitSymbol,
          dispatchedQuantity: qty,
          dispatchIds,
          dispatchFolios,
          distinctPrices,
          totalCommercialAmount: lineAmount,
        });
      } else {
        existing.dispatchedQuantity = roundQuantity(existing.dispatchedQuantity + qty);
        existing.totalCommercialAmount = roundMoney(
          existing.totalCommercialAmount + lineAmount
        );
        existing.dispatchIds.add(sale.id);
        existing.dispatchFolios.add(sale.folio || sale.id);
        if (unitPrice !== null) {
          existing.distinctPrices.add(unitPrice);
        }
      }

      totalCommercialValue = roundMoney(totalCommercialValue + lineAmount);
    }

    if (saleHasValidLine) {
      countedDispatchIds.push(sale.id);
      countedDispatchFolios.push(sale.folio || sale.id);
    }
  }

  const productBreakdown: PartialCutCommercialProductBreakdownItem[] = Array.from(
    productAccumulator.values()
  )
    .map((acc) => ({
      productId: acc.productId,
      productCode: acc.productCode,
      sku: acc.sku,
      productName: acc.productName,
      measurementUnitId: acc.measurementUnitId,
      unitName: acc.unitName,
      unitSymbol: acc.unitSymbol,
      dispatchedQuantity: acc.dispatchedQuantity,
      dispatchCount: acc.dispatchIds.size,
      dispatchFolios: Array.from(acc.dispatchFolios),
      distinctHistoricalUnitPrices: Array.from(acc.distinctPrices).sort((a, b) => a - b),
      totalCommercialAmount: acc.totalCommercialAmount,
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  // Evaluar si las unidades de medida de los productos despachados son comparables
  let areUnitsComparable = true;
  let comparableTotalQuantity: number | null = 0;
  let comparableUnitName: string | null = null;
  let comparableUnitSymbol: string | null = null;

  if (productBreakdown.length > 0) {
    const first = productBreakdown[0];
    const firstUnitNameKey = (first.unitName || first.unitSymbol || '').trim().toLowerCase();
    const firstUnitIdKey = (first.measurementUnitId || '').trim();

    for (let i = 1; i < productBreakdown.length; i++) {
      const current = productBreakdown[i];
      const currentUnitNameKey = (current.unitName || current.unitSymbol || '')
        .trim()
        .toLowerCase();
      const currentUnitIdKey = (current.measurementUnitId || '').trim();

      const sameUnitName =
        firstUnitNameKey.length > 0 && currentUnitNameKey === firstUnitNameKey;
      const sameUnitId =
        firstUnitIdKey.length === 0 ||
        currentUnitIdKey.length === 0 ||
        currentUnitIdKey === firstUnitIdKey;

      if (!sameUnitName || !sameUnitId) {
        areUnitsComparable = false;
        break;
      }
    }

    if (areUnitsComparable) {
      let sumQty = 0;
      for (const item of productBreakdown) {
        sumQty = roundQuantity(sumQty + item.dispatchedQuantity);
      }
      comparableTotalQuantity = sumQty;
      comparableUnitName = first.unitName;
      comparableUnitSymbol = first.unitSymbol;
    } else {
      comparableTotalQuantity = null;
      comparableUnitName = null;
      comparableUnitSymbol = null;
    }
  }

  // Verificar si existen referencias esperadas de operaciones comerciales que no pudieron localizarse
  const missingRefs = expectedOperationRefs.filter(
    (ref) => ref && !allKnownValidOperationRefsInInterval.has(ref)
  );
  const hasInsufficientHistoricalData = hasMissingPriceData || missingRefs.length > 0;
  const historicalDataNotice = hasInsufficientHistoricalData
    ? 'Algunos registros históricos de despacho previos son incompletos o carecen de detalle de precios congelados. Se muestran únicamente los datos históricos verificables sin inventar importes.'
    : null;

  return {
    workdayId,
    intervalStartAt,
    intervalEndAt,
    isInitialWorkdayInterval: effectiveIsInitialInterval,
    totalDispatchesCount: countedDispatchIds.length,
    distinctProductsCount: productBreakdown.length,
    areUnitsComparable,
    comparableTotalQuantity,
    comparableUnitName,
    comparableUnitSymbol,
    totalCommercialValue,
    productBreakdown,
    dispatchIds: countedDispatchIds,
    dispatchFolios: countedDispatchFolios,
    hasInsufficientHistoricalData,
    historicalDataNotice,
  };
}

/**
 * Resuelve la proyección de Actividad Comercial del Período para cualquier corte parcial
 * (en curso o histórico aprobado) sin modificar cortes aprobados.
 */
export function resolveCutCommercialActivityProjection(params: {
  readonly cut: PartialInventoryCutRecord;
  readonly allSales: readonly SaleRecord[];
  readonly allCutsInWorkday?: readonly PartialInventoryCutRecord[];
  readonly workdayOpenedAt?: ISODateString;
  readonly productsById?: ReadonlyMap<string, ProductRecord>;
  readonly unitsById?: ReadonlyMap<string, { readonly id: string; readonly name: string }>;
}): PartialCutCommercialActivitySummary {
  const {
    cut,
    allSales,
    allCutsInWorkday = [],
    workdayOpenedAt,
    productsById,
    unitsById,
  } = params;

  // Si es un corte ya aprobado que cuenta con su fotografía consolidada íntegra, la conservamos
  if (
    cut.status === PartialCutStatus.APPROVED &&
    cut.commercialActivity &&
    Array.isArray(cut.commercialActivity.productBreakdown)
  ) {
    return cut.commercialActivity;
  }

  const priorApprovedEndTimestamps = allCutsInWorkday
    .filter(
      (c) =>
        c.id !== cut.id &&
        c.status === PartialCutStatus.APPROVED &&
        c.intervalEndAt <= cut.intervalStartAt
    )
    .map((c) => c.intervalEndAt);

  const isInitialWorkdayInterval =
    priorApprovedEndTimestamps.length === 0 &&
    (workdayOpenedAt
      ? cut.intervalStartAt === workdayOpenedAt
      : cut.consecutiveNumber === 1);

  const expectedRefs = Array.from(
    new Set(cut.items.flatMap((item) => item.commercialActivityRefIds ?? []))
  );

  return computeCommercialActivitySummaryFromSales({
    workdayId: cut.workdayId,
    intervalStartAt: cut.intervalStartAt,
    intervalEndAt: cut.intervalEndAt,
    sales: allSales,
    isInitialWorkdayInterval,
    priorApprovedCutEndTimestamps: priorApprovedEndTimestamps,
    expectedOperationRefs: expectedRefs,
    fallbackCutItems: cut.items,
    productsById,
    unitsById,
  });
}

/**
 * Redacta los costos de compra y balances económicos sensibles del resumen de inventario
 * cuando el actor no cuenta con permisos administrativos/de costos (ej. Cajero).
 */
export function sanitizePartialCutSummaryForActor(
  summary: PartialCutSummaryMetrics,
  canViewCosts: boolean,
  canViewInventoryBalances: boolean
): PartialCutSummaryMetrics {
  if (canViewCosts && canViewInventoryBalances) {
    return summary;
  }
  return {
    ...summary,
    totalShortagePurchaseValue: 0,
    totalSurplusPurchaseValue: 0,
    netPurchaseBalance: 0,
    totalShortageSaleValue: canViewInventoryBalances ? summary.totalShortageSaleValue : 0,
    totalSurplusSaleValue: canViewInventoryBalances ? summary.totalSurplusSaleValue : 0,
    netSaleBalance: canViewInventoryBalances ? summary.netSaleBalance : 0,
  };
}

/**
 * Redacta costos de compra y valoraciones sensibles de una partida reconciliada según permisos del actor.
 */
export function sanitizeReconciliationItemForActor(
  item: PartialCutItemReconciliationResult,
  canViewCosts: boolean,
  canViewInventoryBalances: boolean
): PartialCutItemReconciliationResult {
  if (canViewCosts && canViewInventoryBalances) {
    return item;
  }
  return {
    ...item,
    lastPurchasePriceSnapshot: 0,
    shortagePurchaseValue: 0,
    surplusPurchaseValue: 0,
    netPurchaseImpact: 0,
    differencePurchaseValuation: 0,
    shortageSaleValue: canViewInventoryBalances ? item.shortageSaleValue : 0,
    surplusSaleValue: canViewInventoryBalances ? item.surplusSaleValue : 0,
    netSaleImpact: canViewInventoryBalances ? item.netSaleImpact : 0,
    differenceSaleValuation: canViewInventoryBalances ? item.differenceSaleValuation : 0,
    item: {
      ...item.item,
      lastPurchasePriceSnapshot: 0,
      shortagePurchaseValue: 0,
      surplusPurchaseValue: 0,
      netPurchaseImpact: 0,
      differencePurchaseValuation: 0,
      shortageSaleValue: canViewInventoryBalances ? item.item.shortageSaleValue : 0,
      surplusSaleValue: canViewInventoryBalances ? item.item.surplusSaleValue : 0,
      netSaleImpact: canViewInventoryBalances ? item.item.netSaleImpact : 0,
      differenceSaleValuation: canViewInventoryBalances
        ? item.item.differenceSaleValuation
        : 0,
    },
  };
}

/**
 * Proyecta un registro de corte parcial aplicando tanto la proyección de actividad comercial
 * como las restricciones de permisos del actor sobre costos y balances de inventario.
 */
export function sanitizePartialCutForActor(
  cut: PartialInventoryCutRecord,
  commercialActivity: PartialCutCommercialActivitySummary,
  canViewCosts: boolean,
  canViewInventoryBalances: boolean
): PartialInventoryCutRecord {
  const sanitizedItems =
    canViewCosts && canViewInventoryBalances
      ? cut.items
      : cut.items.map((item) => ({
          ...item,
          lastPurchasePriceSnapshot: 0,
          shortagePurchaseValue: 0,
          surplusPurchaseValue: 0,
          netPurchaseImpact: 0,
          differencePurchaseValuation: 0,
          shortageSaleValue: canViewInventoryBalances ? item.shortageSaleValue : 0,
          surplusSaleValue: canViewInventoryBalances ? item.surplusSaleValue : 0,
          netSaleImpact: canViewInventoryBalances ? item.netSaleImpact : 0,
          differenceSaleValuation: canViewInventoryBalances ? item.differenceSaleValuation : 0,
        }));

  const sanitizedSummary = cut.summary
    ? sanitizePartialCutSummaryForActor(cut.summary, canViewCosts, canViewInventoryBalances)
    : undefined;

  return {
    ...cut,
    items: sanitizedItems,
    summary: sanitizedSummary,
    commercialActivity,
  };
}

/**
 * Determina si un corte parcial admite captura, edición de conteos o transición a revisión.
 * Los cortes APPROVED y CANCELLED son estrictamente inmutables.
 */
export function isEditablePartialCut(status: PartialCutStatus): boolean {
  return status === PartialCutStatus.DRAFT || status === PartialCutStatus.READY_FOR_REVIEW;
}

export const PartialCutItemStatus = {
  PENDING_COUNT: 'PENDING_COUNT',
  CLEAN: 'CLEAN',
  RECONCILED_POST_MOVEMENTS: 'RECONCILED_POST_MOVEMENTS',
  RECOUNT_REQUIRED: 'RECOUNT_REQUIRED',
} as const;

export function isIntegerOnlyMeasurementUnit(unitName?: string): boolean {
  if (!unitName) return false;
  const normalized = unitName.trim().toLowerCase();
  const integerUnits = [
    'pieza',
    'piezas',
    'pza',
    'pzas',
    'unidad',
    'unidades',
    'u.',
    'und',
    'caja',
    'cajas',
    'paquete',
    'paquetes',
    'bolsa',
    'bolsas',
    'botella',
    'botellas',
    'bote',
    'botes',
    'lata',
    'latas',
    'frasco',
    'frascos',
    'sobre',
    'sobres',
    'par',
    'pares',
    'rollo',
    'rollos',
  ];
  return integerUnits.includes(normalized);
}

/**
 * Valida la cantidad física introducida durante el conteo ciego.
 * - Obligatoria y numérica finita.
 * - Se permite 0.
 * - No se permiten negativos.
 * - Si la unidad de medida es discreta (pieza/unidad), exige número entero.
 * - Máximo 2 decimales para unidades fraccionables (kg, litro, etc.).
 */
export function validatePhysicalCountQuantity(raw: unknown, unitName?: string): number {
  if (raw === null || raw === undefined || raw === '') {
    throw new ValidationError('La cantidad física contada es obligatoria.');
  }

  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num)) {
    throw new ValidationError('La cantidad física debe ser un valor numérico válido.');
  }

  if (num < 0) {
    throw new ValidationError('La cantidad física contada no puede ser negativa.');
  }

  if (isIntegerOnlyMeasurementUnit(unitName) && !Number.isInteger(num)) {
    throw new ValidationError(
      `El producto se mide en "${unitName}" y solo admite cantidades enteras sin decimales.`
    );
  }

  const str = num.toString();
  const decimals = (str.split('.')[1] || '').length;
  if (decimals > 2) {
    throw new ValidationError('La cantidad física contada admite un máximo de 2 decimales.');
  }

  return roundQuantity(num);
}

/**
 * Calcula de forma determinista el inicio del intervalo cubierto por un nuevo corte parcial.
 * - Primer corte: desde la apertura de la jornada (workdayOpenedAt).
 * - Cortes posteriores: desde el final del último intervalo APROBADO (APPROVED).
 * - Los cortes CANCELLED nunca se consideran cubiertos; el siguiente corte recupera su intervalo.
 */
export function computeNextPartialCutIntervalStart(
  workdayOpenedAt: ISODateString,
  existingCutsInWorkday: readonly PartialInventoryCutRecord[]
): ISODateString {
  const approvedCuts = existingCutsInWorkday
    .filter((cut) => cut.status === PartialCutStatus.APPROVED)
    .sort((a, b) => a.intervalEndAt.localeCompare(b.intervalEndAt));

  if (approvedCuts.length === 0) {
    return workdayOpenedAt;
  }

  const lastApproved = approvedCuts[approvedCuts.length - 1];
  return lastApproved.intervalEndAt;
}

/**
 * Verifica que no existan borradores simultáneos ni solapamientos de intervalos en la jornada.
 */
export function validateNoOverlappingPartialCuts(
  workdayOpenedAt: ISODateString,
  intervalStartAt: ISODateString,
  intervalEndAt: ISODateString,
  existingCutsInWorkday: readonly PartialInventoryCutRecord[]
): void {
  const activeDraftOrReview = existingCutsInWorkday.find(
    (c) => c.status === PartialCutStatus.DRAFT || c.status === PartialCutStatus.READY_FOR_REVIEW
  );

  if (activeDraftOrReview) {
    throw new ValidationError(
      `Ya existe un corte parcial en curso (${activeDraftOrReview.reference}) en estado "${PARTIAL_CUT_STATUS_LABELS[activeDraftOrReview.status]}". Debes concluirlo o cancelarlo antes de crear uno nuevo para evitar intervalos ambiguos o solapados.`
    );
  }

  if (intervalStartAt < workdayOpenedAt) {
    throw new ValidationError(
      'El inicio del intervalo del corte parcial no puede ser anterior a la apertura de la jornada.'
    );
  }

  if (intervalEndAt <= intervalStartAt) {
    throw new ValidationError(
      'La fecha y hora de referencia del corte debe ser posterior al inicio del intervalo cubierto.'
    );
  }

  const approvedCuts = existingCutsInWorkday.filter((c) => c.status === PartialCutStatus.APPROVED);
  for (const approved of approvedCuts) {
    // Solapamiento si intervalStartAt < approved.intervalEndAt y intervalEndAt > approved.intervalStartAt
    if (intervalStartAt < approved.intervalEndAt && intervalEndAt > approved.intervalStartAt) {
      throw new ValidationError(
        `El intervalo solicitado (${intervalStartAt} – ${intervalEndAt}) se solapa con el corte aprobado ${approved.reference} (${approved.intervalStartAt} – ${approved.intervalEndAt}).`
      );
    }
  }
}

/**
 * Proyecta una partida a la vista de Conteo Ciego garantizando que jamás se expongan
 * la existencia teórica ni las diferencias ni los precios/costos.
 */
export function toBlindCountItemView(item: PartialCutProductItem): BlindCountProductItemView {
  return {
    productId: item.productId,
    productName: item.productName,
    productCode: item.productCode,
    sku: item.sku,
    categoryName: item.categoryName,
    unitName: item.unitName,
    unitSymbol: item.unitSymbol,
    captureStatus: item.captureStatus,
    countedPhysicalQuantity: item.countedPhysicalQuantity,
    countedAt: item.countedAt,
    attemptCount: item.countHistory.length,
  };
}

/**
 * Reconstruye la existencia teórica de un producto en un instante de referencia usando
 * los movimientos reales del Kardex.
 */
export function reconstructTheoreticalStockAtTimestamp(
  currentStock: number,
  targetTimestamp: ISODateString,
  productMovements: readonly InventoryMovementRecord[]
): number {
  const sorted = productMovements
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (sorted.length === 0) {
    return currentStock;
  }

  const afterTarget = sorted.filter((m) => m.timestamp > targetTimestamp);
  if (afterTarget.length > 0) {
    return afterTarget[0].previousStock;
  }

  const atOrBefore = sorted.filter((m) => m.timestamp <= targetTimestamp);
  if (atOrBefore.length > 0) {
    return atOrBefore[atOrBefore.length - 1].resultingStock;
  }

  return currentStock;
}

/**
 * Construye el resultado de conciliación congelado para una partida de un corte parcial ya APROBADO,
 * garantizando su inmutabilidad aunque el producto sufra movimientos o cambios de precio posteriores.
 */
export function buildApprovedItemReconciliationResult(
  item: PartialCutProductItem
): PartialCutItemReconciliationResult {
  const refStock =
    item.theoreticalStockAtCutReference ?? item.theoreticalStockAtCutCreation;
  const reconciledStock =
    item.reconciledTheoreticalStock ??
    item.theoreticalStockAtCountTime ??
    refStock;
  const countedQty =
    item.countedPhysicalQuantity ?? item.physicalCountQuantity ?? 0;
  const diffQty =
    item.differenceQuantity !== null && item.differenceQuantity !== undefined
      ? item.differenceQuantity
      : roundQuantity(countedQty - reconciledStock);

  const valuation = computeItemDifferenceValuation(
    diffQty,
    item.lastPurchasePriceSnapshot ?? 0,
    item.salePriceSnapshot ?? 0
  );

  const stockBefore = item.stockBeforeApproval ?? reconciledStock;
  const stockAfter = item.stockAfterApproval ?? roundQuantity(stockBefore + diffQty);
  const preDelta = roundQuantity(reconciledStock - refStock);
  const postDelta = roundQuantity(stockBefore - reconciledStock);

  return {
    item,
    productId: item.productId,
    productName: item.productName,
    productCode: item.productCode,
    sku: item.sku,
    categoryName: item.categoryName,
    unitName: item.unitName,
    unitSymbol: item.unitSymbol,
    captureStatus: 'COUNTED',
    reconciliationStatus: postDelta !== 0 || preDelta !== 0 ? 'RECONCILED_POST_MOVEMENTS' : 'CLEAN',
    requiresRecount: false,
    conflictReason: null,
    theoreticalStockAtCutReference: refStock,
    theoreticalStockAtReference: reconciledStock,
    reconciledStockAtCount: reconciledStock,
    reconciledTheoreticalStock: reconciledStock,
    currentSystemStock: stockBefore,
    countedPhysicalQuantity: countedQty,
    physicalCountQuantity: countedQty,
    countedAt: item.countedAt,
    preCountDelta: preDelta,
    preCountMovements: [],
    netPostCountDelta: postDelta,
    adjustedPhysicalQuantityAtReview: stockAfter,
    physicalDifference: valuation.differenceQuantity,
    differenceQuantity: valuation.differenceQuantity,
    differenceFromReconciled: valuation.differenceQuantity,
    differenceType: item.differenceType ?? valuation.differenceType,
    differenceReason: item.differenceReason ?? null,
    requiresDifferenceReason: valuation.differenceType !== 'NONE',
    hasValidDifferenceReason:
      valuation.differenceType === 'NONE' || Boolean(item.differenceReason?.trim()),
    lastPurchasePriceSnapshot: item.lastPurchasePriceSnapshot ?? 0,
    salePriceSnapshot: item.salePriceSnapshot ?? 0,
    shortagePurchaseValue: item.shortagePurchaseValue ?? valuation.shortagePurchaseValue,
    shortageSaleValue: item.shortageSaleValue ?? valuation.shortageSaleValue,
    surplusPurchaseValue: item.surplusPurchaseValue ?? valuation.surplusPurchaseValue,
    surplusSaleValue: item.surplusSaleValue ?? valuation.surplusSaleValue,
    netPurchaseImpact: item.netPurchaseImpact ?? valuation.netPurchaseImpact,
    netSaleImpact: item.netSaleImpact ?? valuation.netSaleImpact,
    differencePurchaseValuation: item.netPurchaseImpact ?? valuation.netPurchaseImpact,
    differenceSaleValuation: item.netSaleImpact ?? valuation.netSaleImpact,
    stockBeforeApproval: stockBefore,
    stockAfterApproval: stockAfter,
    appliedAdjustmentMovementId: item.appliedAdjustmentMovementId ?? null,
    postCountMovements: [],
    countHistory: item.countHistory,
  };
}

/**
 * Evalúa y concilia los movimientos de inventario ocurridos entre la referencia del corte,
 * el instante de conteo físico y el momento de revisión/aprobación de un producto.
 */
export function reconcilePartialCutItemWithPostMovements(
  item: PartialCutProductItem,
  currentSystemStock: number,
  productMovements: readonly InventoryMovementRecord[],
  cutReferenceTimestamp?: ISODateString,
  cutId?: EntityId
): PartialCutItemReconciliationResult {
  const cutRefStock =
    item.theoreticalStockAtCutReference ?? item.theoreticalStockAtCutCreation;
  const referenceStock =
    item.theoreticalStockAtCountTime !== null
      ? item.theoreticalStockAtCountTime
      : cutRefStock;

  const lastPurchasePriceSnapshot = item.lastPurchasePriceSnapshot ?? 0;
  const salePriceSnapshot = item.salePriceSnapshot ?? 0;
  const existingReason = item.differenceReason ?? null;

  if (item.countedPhysicalQuantity === null || !item.countedAt) {
    return {
      item,
      productId: item.productId,
      productName: item.productName,
      productCode: item.productCode,
      sku: item.sku,
      categoryName: item.categoryName,
      unitName: item.unitName,
      unitSymbol: item.unitSymbol,
      captureStatus: 'PENDING',
      reconciliationStatus: 'PENDING_COUNT',
      requiresRecount: false,
      conflictReason: null,
      theoreticalStockAtCutReference: cutRefStock,
      theoreticalStockAtReference: referenceStock,
      reconciledStockAtCount: referenceStock,
      reconciledTheoreticalStock: currentSystemStock,
      currentSystemStock,
      countedPhysicalQuantity: null,
      physicalCountQuantity: null,
      countedAt: null,
      preCountDelta: roundQuantity(currentSystemStock - cutRefStock),
      preCountMovements: [],
      netPostCountDelta: 0,
      adjustedPhysicalQuantityAtReview: null,
      physicalDifference: null,
      differenceQuantity: null,
      differenceFromReconciled: null,
      differenceType: null,
      differenceReason: existingReason,
      requiresDifferenceReason: false,
      hasValidDifferenceReason: true,
      lastPurchasePriceSnapshot,
      salePriceSnapshot,
      shortagePurchaseValue: 0,
      shortageSaleValue: 0,
      surplusPurchaseValue: 0,
      surplusSaleValue: 0,
      netPurchaseImpact: 0,
      netSaleImpact: 0,
      differencePurchaseValuation: 0,
      differenceSaleValuation: 0,
      postCountMovements: [],
      countHistory: item.countHistory,
    };
  }

  const countedAt = item.countedAt;
  const countedQty = item.countedPhysicalQuantity;

  // Filtrar movimientos de este producto excluyendo ajustes propios de este mismo corte
  const allProductMovements = productMovements
    .filter(
      (m) =>
        m.productId === item.productId &&
        (!cutId || (m.partialCutId !== cutId && m.originOperationId !== cutId))
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Movimientos ocurridos entre cutReferenceTimestamp y countedAt (antes del conteo físico)
  const preCountRaw = cutReferenceTimestamp
    ? allProductMovements.filter(
        (m) => m.timestamp > cutReferenceTimestamp && m.timestamp < countedAt
      )
    : [];

  const preCountMovements: ReconciledPostMovementItem[] = preCountRaw.map((m) => ({
    movementId: m.id,
    movementType: m.movementType,
    quantity: m.quantity,
    signedDelta: getSignedMovementDelta(m),
    previousStock: m.previousStock,
    resultingStock: m.resultingStock,
    timestamp: m.timestamp,
    reason: m.reason,
  }));

  let preCountDelta = 0;
  for (const pm of preCountMovements) {
    preCountDelta = roundQuantity(preCountDelta + pm.signedDelta);
  }

  // Movimientos ocurridos en o después del instante de conteo
  const relevantMovements = allProductMovements.filter((m) => m.timestamp >= countedAt);

  // Detectar colisión exacta de marca temporal
  const exactTimestampCollision = relevantMovements.some((m) => m.timestamp === countedAt);
  const postMovements = relevantMovements.filter((m) => m.timestamp > countedAt);

  const postReconciledList: ReconciledPostMovementItem[] = postMovements.map((m) => ({
    movementId: m.id,
    movementType: m.movementType,
    quantity: m.quantity,
    signedDelta: getSignedMovementDelta(m),
    previousStock: m.previousStock,
    resultingStock: m.resultingStock,
    timestamp: m.timestamp,
    reason: m.reason,
  }));

  const buildRecountRequiredResult = (
    reasonMsg: string,
    deltaSoFar = 0
  ): PartialCutItemReconciliationResult => ({
    item,
    productId: item.productId,
    productName: item.productName,
    productCode: item.productCode,
    sku: item.sku,
    categoryName: item.categoryName,
    unitName: item.unitName,
    unitSymbol: item.unitSymbol,
    captureStatus: 'RECOUNT_REQUIRED',
    reconciliationStatus: 'RECOUNT_REQUIRED',
    requiresRecount: true,
    conflictReason: reasonMsg,
    theoreticalStockAtCutReference: cutRefStock,
    theoreticalStockAtReference: referenceStock,
    reconciledStockAtCount: referenceStock,
    reconciledTheoreticalStock: referenceStock,
    currentSystemStock,
    countedPhysicalQuantity: countedQty,
    physicalCountQuantity: countedQty,
    countedAt,
    preCountDelta,
    preCountMovements,
    netPostCountDelta: deltaSoFar,
    adjustedPhysicalQuantityAtReview: null,
    physicalDifference: null,
    differenceQuantity: null,
    differenceFromReconciled: null,
    differenceType: null,
    differenceReason: existingReason,
    requiresDifferenceReason: false,
    hasValidDifferenceReason: false,
    lastPurchasePriceSnapshot,
    salePriceSnapshot,
    shortagePurchaseValue: 0,
    shortageSaleValue: 0,
    surplusPurchaseValue: 0,
    surplusSaleValue: 0,
    netPurchaseImpact: 0,
    netSaleImpact: 0,
    differencePurchaseValuation: 0,
    differenceSaleValuation: 0,
    postCountMovements: postReconciledList,
    countHistory: item.countHistory,
  });

  if (exactTimestampCollision) {
    return buildRecountRequiredResult(
      'Se detectó un movimiento de inventario en el mismo instante exacto del conteo físico. Se requiere reconteo para garantizar certidumbre.'
    );
  }

  // Validar continuidad de movimientos ocurridos entre la referencia del corte y el conteo físico
  if (preCountRaw.length > 0) {
    let runningPreStock = cutRefStock;
    for (const mov of preCountRaw) {
      const signedDelta = getSignedMovementDelta(mov);
      if (
        !Number.isFinite(mov.quantity) ||
        !Number.isFinite(mov.previousStock) ||
        !Number.isFinite(mov.resultingStock) ||
        Math.abs(mov.previousStock - runningPreStock) > 0.001 ||
        Math.abs(roundQuantity(mov.previousStock + signedDelta) - mov.resultingStock) > 0.001
      ) {
        return buildRecountRequiredResult(
          'Inconsistencia en los movimientos ocurridos entre la hora de referencia del corte y el conteo físico. Se requiere reconteo.'
        );
      }
      runningPreStock = mov.resultingStock;
    }
    if (Math.abs(runningPreStock - referenceStock) > 0.001) {
      return buildRecountRequiredResult(
        'La existencia teórica al momento del conteo no concuerda con los movimientos registrados desde la referencia del corte.'
      );
    }
  }

  // Si no hubo movimientos posteriores al conteo
  if (postMovements.length === 0) {
    // Verificar que el stock del sistema no haya cambiado sin rastro auditable
    if (Math.abs(currentSystemStock - referenceStock) > 0.001) {
      return buildRecountRequiredResult(
        'La existencia actual del producto difiere de la existencia en el instante de conteo sin movimientos auditables conciliables.'
      );
    }

    if (item.captureStatus === 'RECOUNT_REQUIRED') {
      return buildRecountRequiredResult('Marcado previamente para reconteo obligatorio.');
    }

    const diff = roundQuantity(countedQty - referenceStock);
    const valuation = computeItemDifferenceValuation(
      diff,
      lastPurchasePriceSnapshot,
      salePriceSnapshot
    );
    const requiresReason = valuation.differenceType !== 'NONE';

    return {
      item,
      productId: item.productId,
      productName: item.productName,
      productCode: item.productCode,
      sku: item.sku,
      categoryName: item.categoryName,
      unitName: item.unitName,
      unitSymbol: item.unitSymbol,
      captureStatus: 'COUNTED',
      reconciliationStatus: preCountMovements.length > 0 ? 'RECONCILED_POST_MOVEMENTS' : 'CLEAN',
      requiresRecount: false,
      conflictReason: null,
      theoreticalStockAtCutReference: cutRefStock,
      theoreticalStockAtReference: referenceStock,
      reconciledStockAtCount: referenceStock,
      reconciledTheoreticalStock: referenceStock,
      currentSystemStock,
      countedPhysicalQuantity: countedQty,
      physicalCountQuantity: countedQty,
      countedAt,
      preCountDelta,
      preCountMovements,
      netPostCountDelta: 0,
      adjustedPhysicalQuantityAtReview: countedQty,
      physicalDifference: valuation.differenceQuantity,
      differenceQuantity: valuation.differenceQuantity,
      differenceFromReconciled: valuation.differenceQuantity,
      differenceType: valuation.differenceType,
      differenceReason: existingReason,
      requiresDifferenceReason: requiresReason,
      hasValidDifferenceReason: !requiresReason || Boolean(existingReason?.trim()),
      lastPurchasePriceSnapshot,
      salePriceSnapshot,
      shortagePurchaseValue: valuation.shortagePurchaseValue,
      shortageSaleValue: valuation.shortageSaleValue,
      surplusPurchaseValue: valuation.surplusPurchaseValue,
      surplusSaleValue: valuation.surplusSaleValue,
      netPurchaseImpact: valuation.netPurchaseImpact,
      netSaleImpact: valuation.netSaleImpact,
      differencePurchaseValuation: valuation.netPurchaseImpact,
      differenceSaleValuation: valuation.netSaleImpact,
      postCountMovements: preCountMovements,
      countHistory: item.countHistory,
    };
  }

  // Validar cada movimiento posterior al conteo físico
  let expectedRunningStock = referenceStock;
  let netDelta = 0;

  for (const mov of postMovements) {
    if (
      !Number.isFinite(mov.quantity) ||
      !Number.isFinite(mov.previousStock) ||
      !Number.isFinite(mov.resultingStock) ||
      !mov.originOperationId ||
      !mov.responsibleUserId
    ) {
      return buildRecountRequiredResult(
        'Se detectó un movimiento posterior con datos incompletos o sin referencia de auditoría verificable.',
        netDelta
      );
    }

    // Si ocurrió una corrección manual directa de existencias o un ajuste de otro corte después de haber contado el producto,
    // el conteo previo queda invalidado y exige reconteo.
    if (
      mov.movementType === InventoryMovementType.CORRECTION_POSITIVE ||
      mov.movementType === InventoryMovementType.CORRECTION_NEGATIVE ||
      mov.movementType === InventoryMovementType.PARTIAL_CUT_ADJUSTMENT
    ) {
      return buildRecountRequiredResult(
        'Se ejecutó una corrección o ajuste manual de existencias después del conteo físico. Es obligatorio volver a contar el producto.',
        netDelta
      );
    }

    const signedDelta = getSignedMovementDelta(mov);

    // Verificar continuidad en cadena de saldos del Kardex
    if (
      Math.abs(mov.previousStock - expectedRunningStock) > 0.001 ||
      Math.abs(roundQuantity(mov.previousStock + signedDelta) - mov.resultingStock) > 0.001
    ) {
      return buildRecountRequiredResult(
        'Inconsistencia en la secuencia de saldos de movimientos posteriores al conteo. Se requiere reconteo.',
        netDelta
      );
    }

    expectedRunningStock = mov.resultingStock;
    netDelta = roundQuantity(netDelta + signedDelta);
  }

  // Verificar que el último saldo de la cadena coincida con el stock actual del producto
  if (Math.abs(expectedRunningStock - currentSystemStock) > 0.001) {
    return buildRecountRequiredResult(
      'El saldo resultante de los movimientos posteriores no concuerda con la existencia actual del producto.',
      netDelta
    );
  }

  const adjustedPhysical = roundQuantity(countedQty + netDelta);
  if (adjustedPhysical < 0) {
    return buildRecountRequiredResult(
      'Los movimientos posteriores proyectan una existencia física ajustada negativa. Se requiere reconteo físico.',
      netDelta
    );
  }

  const physicalDiff = roundQuantity(adjustedPhysical - currentSystemStock);
  const valuation = computeItemDifferenceValuation(
    physicalDiff,
    lastPurchasePriceSnapshot,
    salePriceSnapshot
  );
  const requiresReason = valuation.differenceType !== 'NONE';

  return {
    item,
    productId: item.productId,
    productName: item.productName,
    productCode: item.productCode,
    sku: item.sku,
    categoryName: item.categoryName,
    unitName: item.unitName,
    unitSymbol: item.unitSymbol,
    captureStatus: 'COUNTED',
    reconciliationStatus: 'RECONCILED_POST_MOVEMENTS',
    requiresRecount: false,
    conflictReason: null,
    theoreticalStockAtCutReference: cutRefStock,
    theoreticalStockAtReference: referenceStock,
    reconciledStockAtCount: referenceStock,
    reconciledTheoreticalStock: referenceStock,
    currentSystemStock,
    countedPhysicalQuantity: countedQty,
    physicalCountQuantity: countedQty,
    countedAt,
    preCountDelta,
    preCountMovements,
    netPostCountDelta: netDelta,
    adjustedPhysicalQuantityAtReview: adjustedPhysical,
    physicalDifference: valuation.differenceQuantity,
    differenceQuantity: valuation.differenceQuantity,
    differenceFromReconciled: valuation.differenceQuantity,
    differenceType: valuation.differenceType,
    differenceReason: existingReason,
    requiresDifferenceReason: requiresReason,
    hasValidDifferenceReason: !requiresReason || Boolean(existingReason?.trim()),
    lastPurchasePriceSnapshot,
    salePriceSnapshot,
    shortagePurchaseValue: valuation.shortagePurchaseValue,
    shortageSaleValue: valuation.shortageSaleValue,
    surplusPurchaseValue: valuation.surplusPurchaseValue,
    surplusSaleValue: valuation.surplusSaleValue,
    netPurchaseImpact: valuation.netPurchaseImpact,
    netSaleImpact: valuation.netSaleImpact,
    differencePurchaseValuation: valuation.netPurchaseImpact,
    differenceSaleValuation: valuation.netSaleImpact,
    postCountMovements: [...preCountMovements, ...postReconciledList],
    countHistory: item.countHistory,
  };
}

// ============================================================================
// CONTRATOS Y REGLAS DE DOMINIO PARA INVENTARIO FINAL Y REUTILIZACIÓN DE CONTEOS
// ============================================================================

/**
 * Motivo auditado por el cual un producto se incluye o excluye automáticamente
 * del inventario final de cierre de jornada.
 */
export type FinalInventoryInclusionReason =
  | 'ACTIVE_SINCE_OPENING_AND_CURRENTLY_ACTIVE'
  | 'ACTIVE_DURING_WORKDAY_AND_LATER_DEACTIVATED'
  | 'INACTIVE_AT_OPENING_AND_ACTIVATED_DURING_WORKDAY'
  | 'INACTIVE_DURING_ENTIRE_WORKDAY';

/**
 * Resultado de evaluar si un producto estuvo activo en algún momento de la jornada
 * utilizando registros reales de ProductStatusChangeRecord y marcas temporales.
 */
export interface FinalInventoryProductActivityEvaluation {
  readonly productId: EntityId;
  readonly shouldIncludeInFinalInventory: boolean;
  readonly wasActiveAtWorkdayOpening: boolean;
  readonly wasActiveAtAnyMomentDuringWorkday: boolean;
  readonly currentStatus: ProductStatus;
  readonly statusAtWorkdayOpening: ProductStatus;
  readonly inclusionReason: FinalInventoryInclusionReason;
  readonly relevantStatusChangeIds: readonly EntityId[];
}

/**
 * Reconstruye de forma determinista el estado administrativo real que tenía un producto
 * en el instante exacto de apertura de la jornada (`workdayOpenedAt`), utilizando
 * el historial real de `ProductStatusChangeRecord` ordenado cronológicamente.
 */
export function reconstructProductStatusAtTimestamp(
  product: ProductRecord,
  targetTimestamp: ISODateString,
  productStatusChanges: readonly ProductStatusChangeRecord[]
): ProductStatus {
  const sortedChanges = productStatusChanges
    .filter((c) => c.productId === product.id)
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt));

  if (sortedChanges.length === 0) {
    return product.status;
  }

  const changesAtOrBefore = sortedChanges.filter((c) => c.changedAt <= targetTimestamp);
  if (changesAtOrBefore.length > 0) {
    return changesAtOrBefore[changesAtOrBefore.length - 1].newStatus;
  }

  return sortedChanges[0].previousStatus;
}

/**
 * Evalúa si un producto debe incluirse automáticamente en el Inventario Final de la jornada.
 */
export function evaluateProductActivityForFinalInventory(
  product: ProductRecord,
  workdayOpenedAt: ISODateString,
  productStatusChanges: readonly ProductStatusChangeRecord[],
  evaluationEndAt?: ISODateString
): FinalInventoryProductActivityEvaluation {
  const sortedChanges = productStatusChanges
    .filter((c) => c.productId === product.id)
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt));

  const effectiveStartAt =
    product.createdAt > workdayOpenedAt ? product.createdAt : workdayOpenedAt;

  if (evaluationEndAt && product.createdAt > evaluationEndAt) {
    return {
      productId: product.id,
      shouldIncludeInFinalInventory: false,
      wasActiveAtWorkdayOpening: false,
      wasActiveAtAnyMomentDuringWorkday: false,
      currentStatus: product.status,
      statusAtWorkdayOpening: ProductStatus.INACTIVE,
      inclusionReason: 'INACTIVE_DURING_ENTIRE_WORKDAY',
      relevantStatusChangeIds: [],
    };
  }

  const statusAtOpening = reconstructProductStatusAtTimestamp(
    product,
    effectiveStartAt,
    sortedChanges
  );
  const wasActiveAtWorkdayOpening = statusAtOpening === ProductStatus.ACTIVE;

  const changesDuringWorkday = sortedChanges.filter((c) => {
    const afterStart = c.changedAt >= effectiveStartAt;
    const beforeEnd = evaluationEndAt ? c.changedAt <= evaluationEndAt : true;
    return afterStart && beforeEnd;
  });

  const hadActiveTransitionDuringWorkday = changesDuringWorkday.some(
    (c) =>
      c.previousStatus === ProductStatus.ACTIVE || c.newStatus === ProductStatus.ACTIVE
  );

  const changesAfterEnd = evaluationEndAt
    ? sortedChanges.filter((c) => c.changedAt > evaluationEndAt)
    : [];
  const statusAtEnd =
    changesAfterEnd.length > 0 ? changesAfterEnd[0].previousStatus : product.status;

  const wasActiveAtAnyMomentDuringWorkday =
    wasActiveAtWorkdayOpening ||
    hadActiveTransitionDuringWorkday ||
    statusAtEnd === ProductStatus.ACTIVE;

  let inclusionReason: FinalInventoryInclusionReason;
  if (!wasActiveAtAnyMomentDuringWorkday) {
    inclusionReason = 'INACTIVE_DURING_ENTIRE_WORKDAY';
  } else if (wasActiveAtWorkdayOpening && statusAtEnd === ProductStatus.ACTIVE) {
    inclusionReason = 'ACTIVE_SINCE_OPENING_AND_CURRENTLY_ACTIVE';
  } else if (!wasActiveAtWorkdayOpening && wasActiveAtAnyMomentDuringWorkday) {
    inclusionReason = 'INACTIVE_AT_OPENING_AND_ACTIVATED_DURING_WORKDAY';
  } else {
    inclusionReason = 'ACTIVE_DURING_WORKDAY_AND_LATER_DEACTIVATED';
  }

  return {
    productId: product.id,
    shouldIncludeInFinalInventory: wasActiveAtAnyMomentDuringWorkday,
    wasActiveAtWorkdayOpening,
    wasActiveAtAnyMomentDuringWorkday,
    currentStatus: product.status,
    statusAtWorkdayOpening: statusAtOpening,
    inclusionReason,
    relevantStatusChangeIds: changesDuringWorkday.map((c) => c.id),
  };
}

/**
 * Selecciona automáticamente todos los productos que deben auditarse en el Inventario Final
 * de una jornada, sin intervención ni filtrado manual del Administrador.
 */
export function selectProductsForFinalInventory(
  allProducts: readonly ProductRecord[],
  workdayOpenedAt: ISODateString,
  allStatusChanges: readonly ProductStatusChangeRecord[],
  evaluationEndAt?: ISODateString
): readonly {
  readonly product: ProductRecord;
  readonly evaluation: FinalInventoryProductActivityEvaluation;
}[] {
  const results: {
    readonly product: ProductRecord;
    readonly evaluation: FinalInventoryProductActivityEvaluation;
  }[] = [];

  for (const product of allProducts) {
    const evaluation = evaluateProductActivityForFinalInventory(
      product,
      workdayOpenedAt,
      allStatusChanges,
      evaluationEndAt
    );
    if (evaluation.shouldIncludeInFinalInventory) {
      results.push({ product, evaluation });
    }
  }

  return results.sort((a, b) => a.product.name.localeCompare(b.product.name));
}

/**
 * Evaluación de si el conteo físico de un corte parcial aprobado puede reutilizarse
 * en el inventario final o si exige obligatoriamente un nuevo conteo físico.
 */
export interface PartialCutCountReuseEvaluation {
  readonly productId: EntityId;
  readonly canReusePartialCutCount: boolean;
  readonly requiresNewPhysicalCount: boolean;
  /**
   * Cantidad física reutilizable únicamente cuando `canReusePartialCutCount === true`.
   * Jamás se utiliza una existencia proyectada como sustituto cuando ocurrieron movimientos posteriores.
   */
  readonly reusableCountedQuantity: number | null;
  readonly sourcePartialCutId: EntityId | null;
  readonly sourcePartialCutReference: string | null;
  readonly sourceCountedAt: ISODateString | null;
  readonly postCountMovementsCount: number;
  readonly postCountCommercialOperationsCount: number;
  readonly reason: string;
}

/**
 * Evalúa la relación entre los cortes parciales aprobados de la jornada y el inventario final
 * para un producto específico.
 *
 * Reglas estrictas:
 * - Los cortes parciales aprobados no reemplazan automáticamente el inventario final.
 * - Un conteo físico de un corte parcial (APPROVED) podrá reutilizarse en el inventario final
 *   SOLAMENTE si no ocurrió ningún movimiento de existencias ni operación comercial después de ese conteo (`countedAt`),
 *   exceptuando el propio movimiento compensatorio generado al aprobar dicho corte parcial.
 * - Si hubo ventas, entradas de mercancía, devoluciones, correcciones manuales o cualquier otro movimiento
 *   posterior a `countedAt`, se exige obligatoriamente un nuevo conteo físico (`requiresNewPhysicalCount = true`).
 * - Prohibido utilizar una existencia proyectada como sustituto del reconteo obligatorio.
 */
export function evaluatePartialCutCountReuseForFinalInventory(
  product: ProductRecord,
  existingCutsInWorkday: readonly PartialInventoryCutRecord[],
  productMovements: readonly InventoryMovementRecord[],
  commercialOperationTimestampsForProduct: readonly ISODateString[] = []
): PartialCutCountReuseEvaluation {
  const eligibleCuts = existingCutsInWorkday
    .filter((c) => c.status === PartialCutStatus.APPROVED)
    .sort((a, b) => b.intervalEndAt.localeCompare(a.intervalEndAt));

  let latestCandidate: {
    cut: PartialInventoryCutRecord;
    item: PartialCutProductItem;
    countedAt: ISODateString;
    countedQty: number;
  } | null = null;

  for (const cut of eligibleCuts) {
    const foundItem = cut.items.find(
      (i) =>
        i.productId === product.id &&
        i.countedPhysicalQuantity !== null &&
        i.countedAt !== null &&
        i.captureStatus !== 'RECOUNT_REQUIRED'
    );
    if (foundItem && foundItem.countedAt && foundItem.countedPhysicalQuantity !== null) {
      if (!latestCandidate || foundItem.countedAt > latestCandidate.countedAt) {
        latestCandidate = {
          cut,
          item: foundItem,
          countedAt: foundItem.countedAt,
          countedQty: foundItem.countedPhysicalQuantity,
        };
      }
    }
  }

  if (!latestCandidate) {
    return {
      productId: product.id,
      canReusePartialCutCount: false,
      requiresNewPhysicalCount: true,
      reusableCountedQuantity: null,
      sourcePartialCutId: null,
      sourcePartialCutReference: null,
      sourceCountedAt: null,
      postCountMovementsCount: 0,
      postCountCommercialOperationsCount: 0,
      reason:
        'El producto no cuenta con un conteo físico en cortes parciales aprobados de la jornada; requiere conteo físico obligatorio en el inventario final.',
    };
  }

  const { cut, item, countedAt, countedQty } = latestCandidate;

  // Buscar cualquier movimiento de inventario ajeno al propio ajuste del corte parcial ocurrido después (o en el mismo instante) del conteo
  const postMovements = productMovements.filter(
    (m) =>
      m.productId === product.id &&
      m.timestamp >= countedAt &&
      m.originOperationId !== cut.id &&
      m.partialCutId !== cut.id &&
      m.id !== item.appliedAdjustmentMovementId
  );

  // Buscar cualquier operación comercial ocurrida después del conteo
  const postCommercialOps = commercialOperationTimestampsForProduct.filter(
    (ts) => ts > countedAt
  );

  const expectedStockIfNoExternalMovements =
    item.stockAfterApproval !== undefined && item.stockAfterApproval !== null
      ? item.stockAfterApproval
      : countedQty;
  const stockChangedSinceCount =
    Math.abs(product.currentStock - expectedStockIfNoExternalMovements) > 0.001;

  if (
    postMovements.length > 0 ||
    postCommercialOps.length > 0 ||
    stockChangedSinceCount
  ) {
    return {
      productId: product.id,
      canReusePartialCutCount: false,
      requiresNewPhysicalCount: true,
      reusableCountedQuantity: null,
      sourcePartialCutId: cut.id,
      sourcePartialCutReference: cut.reference,
      sourceCountedAt: countedAt,
      postCountMovementsCount: postMovements.length,
      postCountCommercialOperationsCount: postCommercialOps.length,
      reason:
        'Ocurrieron movimientos de existencias posteriores al conteo del corte parcial. Es obligatorio realizar un nuevo conteo físico en el inventario final (no se permite usar existencia proyectada).',
    };
  }

  return {
    productId: product.id,
    canReusePartialCutCount: true,
    requiresNewPhysicalCount: false,
    reusableCountedQuantity: countedQty,
    sourcePartialCutId: cut.id,
    sourcePartialCutReference: cut.reference,
    sourceCountedAt: countedAt,
    postCountMovementsCount: 0,
    postCountCommercialOperationsCount: 0,
    reason: `Conteo físico del corte parcial aprobado ${cut.reference} elegible para reutilización por ausencia total de movimientos posteriores.`,
  };
}
