import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../domain/entities/OperationLog';
import { BackupFilePort } from '../domain/ports/BackupFilePort';
import { SystemBackupRepository } from '../domain/repositories/SystemBackupRepository';

export class ExportBackupUseCase {
  private readonly backupRepository: SystemBackupRepository;
  private readonly filePort: BackupFilePort;

  constructor(backupRepository: SystemBackupRepository, filePort: BackupFilePort) {
    this.backupRepository = backupRepository;
    this.filePort = filePort;
  }

  public async execute(actor: SessionActor): Promise<string> {
    assertPermission(actor, Permission.MANAGE_BACKUPS, 'exportar copia de seguridad');

    const timestamp = nowISO();
    const auditEntry: OperationLogEntry = {
      id: generateEntityId(),
      module: OperationModule.CORE,
      action: 'EXPORT_BACKUP',
      entityType: 'SystemBackup',
      entityId: null,
      actorRole: actor.role,
      description: 'Exportación manual de copia de seguridad local.',
      createdAt: timestamp,
    };

    const envelope = await this.backupRepository.createBackupSnapshot(auditEntry);
    const serialized = JSON.stringify(envelope, null, 2);
    const safeDate = timestamp.slice(0, 19).replace(/[:T]/g, '-');
    const fileName = `respaldo-establecimiento-${safeDate}.json`;

    await this.filePort.saveJsonBackup(fileName, serialized);
    return fileName;
  }
}
