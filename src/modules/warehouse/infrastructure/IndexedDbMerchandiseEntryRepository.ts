import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { MerchandiseEntryRecord } from '../domain/entities/MerchandiseEntryRecord';
import { MerchandiseEntryRepository } from '../domain/repositories/MerchandiseEntryRepository';

export class IndexedDbMerchandiseEntryRepository implements MerchandiseEntryRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<MerchandiseEntryRecord | undefined> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_MERCHANDISE_ENTRIES],
      'readonly',
      async (tx) => {
        return tx.get<MerchandiseEntryRecord>(StoreName.WAREHOUSE_MERCHANDISE_ENTRIES, id);
      }
    );
  }

  public async findByProductId(productId: EntityId): Promise<MerchandiseEntryRecord[]> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_MERCHANDISE_ENTRIES],
      'readonly',
      async (tx) => {
        const matches = await tx.getAllByIndex<MerchandiseEntryRecord>(
          StoreName.WAREHOUSE_MERCHANDISE_ENTRIES,
          'by_product_id',
          productId
        );
        return matches.sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
      }
    );
  }

  public async save(entry: MerchandiseEntryRecord): Promise<void> {
    await this.engine.runTransaction(
      [StoreName.WAREHOUSE_MERCHANDISE_ENTRIES],
      'readwrite',
      async (tx) => {
        await tx.insert(StoreName.WAREHOUSE_MERCHANDISE_ENTRIES, entry);
      }
    );
  }
}
