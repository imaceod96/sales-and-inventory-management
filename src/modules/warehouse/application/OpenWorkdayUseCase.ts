import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { isOperativeWorkday, WorkdayRecord, WorkdayStatus } from '../domain/entities/WorkdayRecord';

export interface OpenWorkdayInput {
  readonly notes?: string;
  readonly operationId?: string;
}

export interface OpenWorkdayResult {
  readonly workday: WorkdayRecord;
  readonly isDuplicate?: boolean;
}

export class OpenWorkdayUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input?: OpenWorkdayInput
  ): Promise<OpenWorkdayResult> {
    // 1. Autorización: sólo Administrador con permiso MANAGE_INVENTORY_CUTS
    assertPermission(actor, Permission.MANAGE_INVENTORY_CUTS, 'abrir jornada de inventario');

    const timestamp = nowISO();
    const operationId = input?.operationId || generateEntityId();
    const workdayId = generateEntityId();

    return this.transactionManager.runTransaction(
      [StoreName.WAREHOUSE_WORKDAYS, StoreName.OPERATION_HISTORY],
      'readwrite',
      async (tx) => {
        // Idempotencia: si la operación ya se registró con este identificador
        const existingOp = await tx.get<OperationLogEntry>(
          StoreName.OPERATION_HISTORY,
          operationId
        );
        if (existingOp && existingOp.entityId) {
          const existingWorkday = await tx.get<WorkdayRecord>(
            StoreName.WAREHOUSE_WORKDAYS,
            existingOp.entityId
          );
          if (existingWorkday) {
            return { workday: existingWorkday, isDuplicate: true };
          }
        }

        // 2. Unicidad operativa: verificar si ya existe una jornada OPEN, CLOSING o CLOSING_SUSPENDED
        const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
        const activeWorkday = allWorkdays.find((w) => isOperativeWorkday(w.status));

        if (activeWorkday) {
          throw new ValidationError(
            `Ya existe una jornada operativa abierta (${activeWorkday.code}). Debe cerrar la jornada actual antes de abrir una nueva.`
          );
        }

        // 3. Generación de consecutivo visible y folio único JOR-YYYYMMDD-XXX
        const todayDateStr = timestamp.substring(0, 10).replace(/-/g, '');
        const consecutiveNumber =
          allWorkdays.reduce((max, w) => Math.max(max, w.consecutiveNumber || 0), 0) + 1;
        const sequence = String(consecutiveNumber).padStart(3, '0');
        const code = `JOR-${todayDateStr}-${sequence}`;

        // 4. Crear registro de jornada (expediente digital único)
        const newWorkday: WorkdayRecord = {
          id: workdayId,
          consecutiveNumber,
          code,
          openedAt: timestamp,
          openedByUserId: actor.role.toLowerCase(),
          openedByUserLabel: actor.label,
          status: WorkdayStatus.OPEN,
          notes: input?.notes?.trim() || undefined,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        // 5. Inserción atómica en base de datos
        await tx.insert(StoreName.WAREHOUSE_WORKDAYS, newWorkday);

        // 6. Registro de auditoría
        const opEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'OPEN_WORKDAY',
          entityType: 'warehouse_workdays',
          entityId: newWorkday.id,
          actorRole: actor.role,
          description: `Apertura de jornada #${newWorkday.consecutiveNumber} (${newWorkday.code}) por ${actor.label}`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, opEntry);

        return { workday: newWorkday, isDuplicate: false };
      }
    );
  }
}
