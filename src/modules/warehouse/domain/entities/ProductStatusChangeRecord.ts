import { EntityId, ISODateString } from '../../../../shared/types/entity';
import { ProductStatus } from './ProductRecord';

export interface ProductStatusChangeRecord {
  readonly id: EntityId;
  readonly productId: EntityId;
  readonly previousStatus: ProductStatus;
  readonly newStatus: ProductStatus;
  readonly changedAt: ISODateString;
  readonly responsibleUserId: string;
  readonly reason: string;
}
