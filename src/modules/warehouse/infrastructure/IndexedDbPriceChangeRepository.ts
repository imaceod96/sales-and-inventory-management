import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { PriceChangeRecord } from '../domain/entities/ProductHistoryRecords';
import { PriceChangeRepository } from '../domain/repositories/PriceChangeRepository';

export class IndexedDbPriceChangeRepository implements PriceChangeRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<PriceChangeRecord | undefined> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_PRICE_CHANGES],
      'readonly',
      async (tx) => {
        return tx.get<PriceChangeRecord>(StoreName.WAREHOUSE_PRICE_CHANGES, id);
      }
    );
  }

  public async findByProductId(productId: EntityId): Promise<PriceChangeRecord[]> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_PRICE_CHANGES],
      'readonly',
      async (tx) => {
        const matches = await tx.getAllByIndex<PriceChangeRecord>(
          StoreName.WAREHOUSE_PRICE_CHANGES,
          'by_product_id',
          productId
        );
        return matches.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
      }
    );
  }

  public async save(record: PriceChangeRecord): Promise<void> {
    await this.engine.runTransaction(
      [StoreName.WAREHOUSE_PRICE_CHANGES],
      'readwrite',
      async (tx) => {
        await tx.insert(StoreName.WAREHOUSE_PRICE_CHANGES, record);
      }
    );
  }
}
