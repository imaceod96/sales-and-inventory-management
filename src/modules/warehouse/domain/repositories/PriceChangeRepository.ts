import { EntityId } from '../../../../shared/types/entity';
import { PriceChangeRecord } from '../entities/ProductHistoryRecords';

export interface PriceChangeRepository {
  findById(id: EntityId): Promise<PriceChangeRecord | undefined>;
  findByProductId(productId: EntityId): Promise<PriceChangeRecord[]>;
  save(record: PriceChangeRecord): Promise<void>;
}
