import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { SystemStorageSummary } from '../domain/entities/SystemBackup';
import { SystemBackupRepository } from '../domain/repositories/SystemBackupRepository';

export class GetSystemStatusUseCase {
  private readonly backupRepository: SystemBackupRepository;

  constructor(backupRepository: SystemBackupRepository) {
    this.backupRepository = backupRepository;
  }

  public async execute(actor: SessionActor): Promise<SystemStorageSummary> {
    assertPermission(actor, Permission.VIEW_SETTINGS, 'consultar estado del almacenamiento local');
    return this.backupRepository.getStorageSummary();
  }
}
