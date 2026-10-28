import { EntityId } from '../../../../shared/types/entity';
import { InventoryMovementRecord } from '../entities/InventoryMovementRecord';

export interface InventoryMovementRepository {
  findById(id: EntityId): Promise<InventoryMovementRecord | undefined>;
  findByProductId(productId: EntityId): Promise<InventoryMovementRecord[]>;
  save(movement: InventoryMovementRecord): Promise<void>;
}
