import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { WorkdayRecord } from '../domain/entities/WorkdayRecord';
import { WorkdayRepository } from '../domain/repositories/WorkdayRepository';

export class GetActiveWorkdayUseCase {
  private readonly workdayRepository: WorkdayRepository;

  constructor(workdayRepository: WorkdayRepository) {
    this.workdayRepository = workdayRepository;
  }

  public async execute(actor: SessionActor): Promise<WorkdayRecord | null> {
    // Autorización: tanto Administrador como Cajero pueden consultar el estado de la jornada
    assertPermission(actor, Permission.VIEW_INVENTORY_CUTS, 'consultar jornada activa');

    const activeWorkday = await this.workdayRepository.findActiveWorkday();
    return activeWorkday ?? null;
  }
}
