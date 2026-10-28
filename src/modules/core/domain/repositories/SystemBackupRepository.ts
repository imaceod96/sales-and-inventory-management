import { OperationLogEntry } from '../entities/OperationLog';
import { SystemBackupEnvelope, SystemStorageSummary } from '../entities/SystemBackup';

export interface SystemBackupRepository {
  getStorageSummary(): Promise<SystemStorageSummary>;
  createBackupSnapshot(auditEntry: OperationLogEntry): Promise<SystemBackupEnvelope>;
  restoreBackupSnapshot(
    envelope: SystemBackupEnvelope,
    auditEntry: OperationLogEntry
  ): Promise<void>;
}
