import { EntityId, ISODateString } from '../../../../shared/types/entity';
import { InventoryMovementRecord, InventoryMovementType } from './InventoryMovementRecord';
import { MerchandiseEntryRecord } from './MerchandiseEntryRecord';
import { PriceChangeRecord } from './PriceChangeRecord';
import { ProductAvailability, ProductRecord, ProductStatus } from './ProductRecord';
import { ProductStatusChangeRecord } from './ProductStatusChangeRecord';

export { type PriceChangeRecord } from './PriceChangeRecord';
export { type ProductStatusChangeRecord } from './ProductStatusChangeRecord';
export { ProductAvailability, ProductStatus } from './ProductRecord';

export enum ProductHistoryEventType {
  INITIAL_REGISTRATION = 'INITIAL_REGISTRATION',
  MERCHANDISE_ENTRY = 'MERCHANDISE_ENTRY',
  STOCK_CORRECTION = 'STOCK_CORRECTION',
  PARTIAL_CUT_ADJUSTMENT = 'PARTIAL_CUT_ADJUSTMENT',
  SALE_DISPATCH = 'SALE_DISPATCH',
  PRICE_CHANGE = 'PRICE_CHANGE',
  STATUS_CHANGE = 'STATUS_CHANGE',
}

export interface ProductHistorySummary {
  readonly productId: EntityId;
  readonly name: string;
  readonly code: string;
  readonly sku: string | null;
  readonly categoryId: EntityId;
  readonly categoryName?: string;
  readonly categoryLabel: string;
  readonly measurementUnitId: EntityId;
  readonly unitLabel: string;
  readonly unitSymbol?: string;
  readonly status: ProductStatus;
  readonly availability: ProductAvailability;
  readonly currentStock: number;
  readonly currentSalePrice: number;
  readonly lastPurchasePrice?: number;
  readonly marginPercentage?: number;
  readonly createdAt: ISODateString;
}

export interface UnifiedHistoryEvent {
  readonly id: EntityId;
  readonly eventType: ProductHistoryEventType;
  readonly title: string;
  readonly description: string;
  readonly timestamp: ISODateString;
  readonly responsibleUserId: string;
  readonly declaredDate?: string;
  readonly quantity?: number;
  readonly unitPurchasePrice?: number;
  readonly totalCost?: number;
  readonly declaredSalePrice?: number;
  readonly previousStock?: number;
  readonly resultingStock?: number;
  readonly stockDifference?: number;
  readonly correctionType?: 'POSITIVE' | 'NEGATIVE';
  readonly previousSalePrice?: number;
  readonly newSalePrice?: number;
  readonly priceDifference?: number;
  readonly priceChangePercentage?: number;
  readonly priceChangeOrigin?: 'ENTRY' | 'MANUAL';
  readonly previousStatus?: ProductStatus;
  readonly newStatus?: ProductStatus;
  readonly reason?: string | null;
  readonly workdayId?: string | null;
  readonly workdayFolio?: string | null;
  readonly partialCutId?: string | null;
  readonly partialCutFolio?: string | null;
}

export interface KardexMovementEntry {
  readonly id: EntityId;
  readonly timestamp: ISODateString;
  readonly movementType: InventoryMovementType;
  readonly movementTypeLabel: string;
  readonly entryQuantity: number | null;
  readonly exitQuantity: number | null;
  readonly previousStock: number;
  readonly resultingStock: number;
  readonly referenceOrReason: string;
  readonly responsibleUserId: string;
  readonly workdayId?: string | null;
  readonly workdayFolio?: string | null;
  readonly partialCutId?: string | null;
  readonly partialCutFolio?: string | null;
}

export type HistoryOperationFilter =
  | 'ALL'
  | 'ENTRIES'
  | 'SALES'
  | 'CORRECTIONS'
  | 'PARTIAL_CUTS'
  | 'PRICES'
  | 'STATUSES';

export interface ProductHistoryFilters {
  readonly operationType?: HistoryOperationFilter;
  readonly startDate?: string;
  readonly endDate?: string;
}

export interface ProductHistoryQueryResult {
  readonly summary: ProductHistorySummary;
  readonly unifiedEvents: readonly UnifiedHistoryEvent[];
  readonly merchandiseEntries: readonly MerchandiseEntryRecord[];
  readonly kardexMovements: readonly KardexMovementEntry[];
  readonly priceChanges: readonly PriceChangeRecord[];
  readonly statusChanges: readonly ProductStatusChangeRecord[];
}
