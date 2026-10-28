import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { PartialInventoryCutRecord } from '../domain/entities/InventoryCutRecord';
import { InventoryCutRepository } from '../domain/repositories/InventoryCutRepository';

export class IndexedDbInventoryCutRepository implements InventoryCutRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<PartialInventoryCutRecord | undefined> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_INVENTORY_CUTS],
      'readonly',
      async (tx) => {
        return tx.get<PartialInventoryCutRecord>(StoreName.WAREHOUSE_INVENTORY_CUTS, id);
      }
    );
  }

  public async findByReference(reference: string): Promise<PartialInventoryCutRecord | undefined> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_INVENTORY_CUTS],
      'readonly',
      async (tx) => {
        const matches = await tx.getAllByIndex<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          'by_reference',
          reference
        );
        return matches[0];
      }
    );
  }

  public async findByWorkdayId(workdayId: EntityId): Promise<PartialInventoryCutRecord[]> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_INVENTORY_CUTS],
      'readonly',
      async (tx) => {
        const matches = await tx.getAllByIndex<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          'by_workday_id',
          workdayId
        );
        return matches.slice().sort((a, b) => a.consecutiveNumber - b.consecutiveNumber);
      }
    );
  }

  public async findAll(): Promise<PartialInventoryCutRecord[]> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_INVENTORY_CUTS],
      'readonly',
      async (tx) => {
        const records = await tx.getAll<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS
        );
        return records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
    );
  }

  public async count(): Promise<number> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_INVENTORY_CUTS],
      'readonly',
      async (tx) => {
        return tx.count(StoreName.WAREHOUSE_INVENTORY_CUTS);
      }
    );
  }
}
