import { BaseEntity, EntityId, ISODateString } from '../../../../shared/types/entity';

export interface WarehouseClosingRectificationItem {
  readonly productId: EntityId;
  readonly productName: string;
  readonly productCode: string;
  readonly unitSymbol: string;
  readonly originalCount: number;
  readonly rectifiedCount: number;
  readonly difference: number;
  readonly differenceReason?: string;
}

export interface WarehouseClosingRectification extends BaseEntity {
  readonly workdayId: EntityId;
  readonly versionNumber: number;
  readonly rectifiedAt: ISODateString;
  readonly rectifiedByUserId: string;
  readonly rectifiedByUserLabel: string;
  readonly reason: string;
  readonly counts: Record<string, number>;
  readonly differenceReasons: Record<string, string>;
  readonly items: readonly WarehouseClosingRectificationItem[];
  readonly compensatoryMovements: readonly EntityId[];
}
