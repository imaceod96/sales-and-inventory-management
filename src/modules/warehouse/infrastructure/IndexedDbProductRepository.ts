import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { ProductRecord } from '../domain/entities/ProductRecord';
import { ProductRepository } from '../domain/repositories/ProductRepository';

export class IndexedDbProductRepository implements ProductRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<ProductRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      return tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, id);
    });
  }

  public async findByNormalizedName(normalizedName: string): Promise<ProductRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const matches = await tx.getAllByIndex<ProductRecord>(
        StoreName.WAREHOUSE_PRODUCTS,
        'by_normalized_name',
        normalizedName
      );
      return matches[0];
    });
  }

  public async findBySku(sku: string): Promise<ProductRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const matches = await tx.getAllByIndex<ProductRecord>(
        StoreName.WAREHOUSE_PRODUCTS,
        'by_sku',
        sku
      );
      return matches[0];
    });
  }

  public async findAll(): Promise<ProductRecord[]> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const records = await tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS);
      return records.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    });
  }

  public async count(): Promise<number> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      return tx.count(StoreName.WAREHOUSE_PRODUCTS);
    });
  }

  public async save(product: ProductRecord): Promise<void> {
    await this.engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readwrite', async (tx) => {
      await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, product);
    });
  }
}
