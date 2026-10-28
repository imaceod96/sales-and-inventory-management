import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { InventoryMovementRecord } from '../domain/entities/InventoryMovementRecord';
import { InventoryMovementRepository } from '../domain/repositories/InventoryMovementRepository';

export class IndexedDbInventoryMovementRepository implements InventoryMovementRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<InventoryMovementRecord | undefined> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_INVENTORY_MOVEMENTS],
      'readonly',
      async (tx) => {
        return tx.get<InventoryMovementRecord>(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, id);
      }
    );
  }

  public async findByProductId(productId: EntityId): Promise<InventoryMovementRecord[]> {
    return this.engine.runTransaction(
      [StoreName.WAREHOUSE_INVENTORY_MOVEMENTS],
      'readonly',
      async (tx) => {
        const matches = await tx.getAllByIndex<InventoryMovementRecord>(
          StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
          'by_product_id',
          productId
        );
        return matches.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      }
    );
  }

  public async save(movement: InventoryMovementRecord): Promise<void> {
    await this.engine.runTransaction(
      [StoreName.WAREHOUSE_INVENTORY_MOVEMENTS],
      'readwrite',
      async (tx) => {
        await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
      }
    );
  }
}
