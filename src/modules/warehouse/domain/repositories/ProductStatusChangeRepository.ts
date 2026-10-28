import { EntityId } from '../../../../shared/types/entity';
import { ProductStatusChangeRecord } from '../entities/ProductStatusChangeRecord';

export interface ProductStatusChangeRepository {
  findById(id: EntityId): Promise<ProductStatusChangeRecord | undefined>;
  findByProductId(productId: EntityId): Promise<ProductStatusChangeRecord[]>;
  save(record: ProductStatusChangeRecord): Promise<void>;
}
