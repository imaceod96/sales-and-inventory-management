import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { ProductStatusChangeRecord } from '../domain/entities/ProductStatusChangeRecord';
import { ProductStatusChangeRepository } from '../domain/repositories/ProductStatusChangeRepository';

export class IndexedDbProductStatusChangeRepository implements ProductStatusChangeRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<ProductStatusChangeRecord | undefined> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES],
      'readonly',
      async (tx) => {
        return tx.get<ProductStatusChangeRecord>(StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES, id);
      }
    );
  }

  public async findByProductId(productId: EntityId): Promise<ProductStatusChangeRecord[]> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES],
      'readonly',
      async (tx) => {
        const matches = await tx.getAllByIndex<ProductStatusChangeRecord>(
          StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES,
          'by_product_id',
          productId
        );
        return matches.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
      }
    );
  }

  public async save(record: ProductStatusChangeRecord): Promise<void> {
    await this.engine.runTransaction(
      [StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES],
      'readwrite',
      async (tx) => {
        await tx.insert(StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES, record);
      }
    );
  }
}
