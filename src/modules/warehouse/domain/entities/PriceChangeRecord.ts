import { EntityId, ISODateString } from '../../../../shared/types/entity';

export interface PriceChangeRecord {
  readonly id: EntityId;
  readonly productId: EntityId;
  readonly previousSalePrice: number;
  readonly newSalePrice: number;
  readonly lastPurchasePrice: number;
  readonly changedAt: ISODateString;
  readonly responsibleUserId: string;
  readonly reason?: string | null;
}
