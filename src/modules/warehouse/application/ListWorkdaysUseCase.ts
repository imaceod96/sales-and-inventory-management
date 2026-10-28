import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { WorkdayRecord } from '../domain/entities/WorkdayRecord';
import { WorkdayRepository } from '../domain/repositories/WorkdayRepository';

export class ListWorkdaysUseCase {
  private readonly workdayRepository: WorkdayRepository;

  constructor(workdayRepository: WorkdayRepository) {
    this.workdayRepository = workdayRepository;
  }

  public async execute(actor: SessionActor): Promise<WorkdayRecord[]> {
    assertPermission(actor, Permission.VIEW_INVENTORY_CUTS, 'consultar historial de jornadas');
    return this.workdayRepository.findAll();
  }
}
