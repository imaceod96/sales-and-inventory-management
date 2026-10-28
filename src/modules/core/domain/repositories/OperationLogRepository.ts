import { OperationLogEntry } from '../entities/OperationLog';

export interface OperationLogRepository {
  record(entry: OperationLogEntry): Promise<void>;
  findRecent(limit?: number): Promise<OperationLogEntry[]>;
  count(): Promise<number>;
}
