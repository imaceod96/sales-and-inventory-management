import { EntityId } from '../../../../shared/types/entity';
import { MerchandiseEntryRecord } from '../entities/MerchandiseEntryRecord';

export interface MerchandiseEntryRepository {
  findById(id: EntityId): Promise<MerchandiseEntryRecord | undefined>;
  findByProductId(productId: EntityId): Promise<MerchandiseEntryRecord[]>;
  save(entry: MerchandiseEntryRecord): Promise<void>;
}
