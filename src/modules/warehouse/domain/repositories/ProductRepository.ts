import { Repository } from '../../../../shared/types/repository';
import { ProductRecord } from '../entities/ProductRecord';

export interface ProductRepository extends Repository<ProductRecord> {
  findByNormalizedName(normalizedName: string): Promise<ProductRecord | undefined>;
  findBySku(sku: string): Promise<ProductRecord | undefined>;
  save(product: ProductRecord): Promise<void>;
}
