import { EntityId } from '../../../../shared/types/entity';
import { WorkdayRecord } from '../entities/WorkdayRecord';

export interface WorkdayRepository {
  findById(id: EntityId): Promise<WorkdayRecord | undefined>;
  findByCode(code: string): Promise<WorkdayRecord | undefined>;
  findActiveWorkday(): Promise<WorkdayRecord | undefined>;
  findAll(): Promise<WorkdayRecord[]>;
  save(workday: WorkdayRecord): Promise<void>;
}
