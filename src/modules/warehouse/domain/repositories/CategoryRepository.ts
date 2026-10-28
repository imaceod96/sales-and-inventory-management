import { EntityId } from '../../../../shared/types/entity';
import { CategoryRecord } from '../entities/CategoryRecord';

export interface CategoryRepository {
  findById(id: EntityId): Promise<CategoryRecord | undefined>;
  findByNormalizedName(normalizedName: string): Promise<CategoryRecord | undefined>;
  findAll(): Promise<CategoryRecord[]>;
  save(category: CategoryRecord): Promise<void>;
}
