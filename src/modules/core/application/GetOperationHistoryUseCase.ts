import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { OperationLogEntry } from '../domain/entities/OperationLog';
import { OperationLogRepository } from '../domain/repositories/OperationLogRepository';

export class GetOperationHistoryUseCase {
  private readonly operationLogRepository: OperationLogRepository;

  constructor(operationLogRepository: OperationLogRepository) {
    this.operationLogRepository = operationLogRepository;
  }

  public async execute(actor: SessionActor, limit = 50): Promise<OperationLogEntry[]> {
    assertPermission(
      actor,
      Permission.VIEW_OPERATION_HISTORY,
      'consultar historial de operaciones'
    );
    return this.operationLogRepository.findRecent(limit);
  }
}
