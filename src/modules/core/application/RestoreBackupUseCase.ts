import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { BackupValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { computeChecksum } from '../../../shared/utils/checksum';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../domain/entities/OperationLog';
import { SystemBackupEnvelope } from '../domain/entities/SystemBackup';
import { BackupFileInput, BackupFilePort } from '../domain/ports/BackupFilePort';
import { SystemBackupRepository } from '../domain/repositories/SystemBackupRepository';

import { sessionElevationService } from '../../../shared/lib/security/SessionElevationService';

export class RestoreBackupUseCase {
  private readonly backupRepository: SystemBackupRepository;
  private readonly filePort: BackupFilePort;

  constructor(backupRepository: SystemBackupRepository, filePort: BackupFilePort) {
    this.backupRepository = backupRepository;
    this.filePort = filePort;
  }

  public async execute(
    actor: SessionActor,
    file: File | BackupFileInput | string,
    criticalToken: string
  ): Promise<void> {
    assertPermission(actor, Permission.MANAGE_BACKUPS, 'restaurar copia de seguridad');
    sessionElevationService.consumeCriticalToken(criticalToken, 'RESTORE_BACKUP');

    const rawText = await this.filePort.readJsonFile(file);
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new BackupValidationError(
        'El archivo seleccionado no contiene un formato JSON válido.'
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new BackupValidationError('Estructura de respaldo inválida.');
    }

    const candidate = parsed as Partial<SystemBackupEnvelope>;

    if (candidate.format !== 'ESTABLECIMIENTO_BACKUP_V1') {
      throw new BackupValidationError(
        'El archivo no corresponde a una copia de seguridad compatible con esta aplicación.'
      );
    }

    if (typeof candidate.schemaVersion !== 'number' || candidate.schemaVersion < 1) {
      throw new BackupValidationError('Versión de esquema de respaldo inválida.');
    }

    if (!candidate.stores || typeof candidate.stores !== 'object') {
      throw new BackupValidationError('El archivo no contiene almacenes de datos válidos.');
    }

    if (typeof candidate.checksum !== 'string' || !candidate.checksum) {
      throw new BackupValidationError('El respaldo carece de firma de verificación de integridad.');
    }

    const expectedChecksum = await computeChecksum(JSON.stringify(candidate.stores));
    if (expectedChecksum !== candidate.checksum) {
      throw new BackupValidationError(
        'La suma de verificación del respaldo no coincide; el archivo podría haber sido alterado o estar incompleto.'
      );
    }

    const fileNameLabel =
      typeof file === 'string'
        ? 'texto'
        : 'name' in file && typeof file.name === 'string'
          ? file.name
          : 'archivo';

    const auditEntry: OperationLogEntry = {
      id: generateEntityId(),
      module: OperationModule.CORE,
      action: 'RESTORE_BACKUP',
      entityType: 'SystemBackup',
      entityId: null,
      actorRole: actor.role,
      description: `Restauración completa desde archivo (${fileNameLabel}).`,
      createdAt: nowISO(),
    };

    await this.backupRepository.restoreBackupSnapshot(
      candidate as SystemBackupEnvelope,
      auditEntry
    );

    // Revocar elevaciones activas tras restaurar
    sessionElevationService.revokeAll();
  }
}
