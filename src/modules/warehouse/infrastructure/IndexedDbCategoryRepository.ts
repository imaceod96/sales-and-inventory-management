import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { CategoryRecord } from '../domain/entities/CategoryRecord';
import { CategoryRepository } from '../domain/repositories/CategoryRepository';

export class IndexedDbCategoryRepository implements CategoryRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<CategoryRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readonly', async (tx) => {
      return tx.get<CategoryRecord>(StoreName.WAREHOUSE_CATEGORIES, id);
    });
  }

  public async findByNormalizedName(normalizedName: string): Promise<CategoryRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readonly', async (tx) => {
      const matches = await tx.getAllByIndex<CategoryRecord>(
        StoreName.WAREHOUSE_CATEGORIES,
        'by_normalized_name',
        normalizedName
      );
      return matches[0];
    });
  }

  public async findAll(): Promise<CategoryRecord[]> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readonly', async (tx) => {
      const records = await tx.getAll<CategoryRecord>(StoreName.WAREHOUSE_CATEGORIES);
      return records.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    });
  }

  public async save(category: CategoryRecord): Promise<void> {
    await this.engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, category);
    });
  }
}
