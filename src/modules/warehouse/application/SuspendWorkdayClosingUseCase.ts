import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { WorkdayRecord, WorkdayStatus } from '../domain/entities/WorkdayRecord';

export interface SuspendWorkdayClosingInput {
  readonly workdayId?: string;
  readonly reason: string;
}

export interface SuspendWorkdayClosingResult {
  readonly workday: WorkdayRecord;
}

export class SuspendWorkdayClosingUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: SuspendWorkdayClosingInput
  ): Promise<SuspendWorkdayClosingResult> {
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'suspender el cierre de jornada'
    );

    const reason = (input.reason || '').trim();
    if (!reason) {
      throw new ValidationError('El motivo de la suspensión del cierre es obligatorio.');
    }

    const timestamp = nowISO();
    const operationId = generateEntityId();

    return this.transactionManager.runTransaction(
      [StoreName.WAREHOUSE_WORKDAYS, StoreName.OPERATION_HISTORY],
      'readwrite',
      async (tx) => {
        let workday: WorkdayRecord | undefined;
        if (input.workdayId) {
          workday = await tx.get<WorkdayRecord>(
            StoreName.WAREHOUSE_WORKDAYS,
            input.workdayId
          );
          if (!workday) {
            throw new EntityNotFoundError('warehouse_workdays', input.workdayId);
          }
        } else {
          const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
          workday = allWorkdays.find((w) => w.status === WorkdayStatus.CLOSING);
          if (!workday) {
            throw new ValidationError('No existe ninguna jornada en proceso de cierre para suspender.');
          }
        }

        if (workday.status !== WorkdayStatus.CLOSING) {
          throw new ValidationError(
            `Solo se puede suspender el cierre de una jornada en estado CLOSING (estado actual: ${workday.status}).`
          );
        }

        const updatedWorkday: WorkdayRecord = {
          ...workday,
          status: WorkdayStatus.CLOSING_SUSPENDED,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.WAREHOUSE_WORKDAYS, updatedWorkday);

        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'SUSPEND_WORKDAY_CLOSING',
          entityType: 'Workday',
          entityId: workday.id,
          actorRole: actor.role,
          description: `Suspensión del cierre de la Jornada #${workday.consecutiveNumber} (${workday.code}). Motivo: ${reason}`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return { workday: updatedWorkday };
      }
    );
  }
}
