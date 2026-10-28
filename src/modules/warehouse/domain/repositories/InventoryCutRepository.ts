import { EntityId } from '../../../../shared/types/entity';
import { Repository } from '../../../../shared/types/repository';
import { PartialInventoryCutRecord } from '../entities/InventoryCutRecord';

export interface InventoryCutRepository extends Repository<PartialInventoryCutRecord> {
  findByReference(reference: string): Promise<PartialInventoryCutRecord | undefined>;
  findByWorkdayId(workdayId: EntityId): Promise<PartialInventoryCutRecord[]>;
}
