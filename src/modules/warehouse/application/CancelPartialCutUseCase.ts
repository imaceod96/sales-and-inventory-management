import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import {
  isEditablePartialCut,
  PARTIAL_CUT_STATUS_LABELS,
  PartialCutStatus,
  PartialInventoryCutRecord,
} from '../domain/entities/InventoryCutRecord';

export interface CancelPartialCutInput {
  readonly cutId: string;
  readonly reason?: string;
  readonly cancellationReason?: string;
}

export class CancelPartialCutUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: CancelPartialCutInput
  ): Promise<PartialInventoryCutRecord> {
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'cancelar corte parcial de inventario'
    );

    const reason = (input.reason ?? input.cancellationReason ?? '').trim();
    if (!reason) {
      throw new ValidationError(
        'Debes proporcionar un motivo de confirmación para cancelar el corte parcial.'
      );
    }

    return this.transactionManager.runTransaction(
      [StoreName.WAREHOUSE_INVENTORY_CUTS, StoreName.OPERATION_HISTORY],
      'readwrite',
      async (tx) => {
        const cut = await tx.get<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          input.cutId
        );
        if (!cut) {
          throw new EntityNotFoundError('Corte parcial de inventario', input.cutId);
        }

        if (!isEditablePartialCut(cut.status)) {
          throw new ValidationError(
            `El corte parcial ${cut.reference} ya se encuentra en estado "${PARTIAL_CUT_STATUS_LABELS[cut.status]}" y no puede cancelarse.`
          );
        }

        const cancelledAt = nowISO();
        const auditId = generateEntityId();

        const auditEntry: OperationLogEntry = {
          id: auditId,
          module: OperationModule.WAREHOUSE,
          action: 'CANCEL_PARTIAL_CUT',
          entityType: 'PartialInventoryCut',
          entityId: cut.id,
          actorRole: actor.role,
          description: `Cancelación del corte parcial ${cut.reference} (Jornada ${cut.workdayCode}). Motivo: ${reason}. No se aplicaron diferencias al stock ni se cubrió el intervalo.`,
          createdAt: cancelledAt,
        };

        const cancelledCut: PartialInventoryCutRecord = {
          ...cut,
          status: PartialCutStatus.CANCELLED,
          statusLabel: PARTIAL_CUT_STATUS_LABELS[PartialCutStatus.CANCELLED],
          cancelledAt,
          cancelledByUserId: actor.role,
          cancelledByUserLabel: actor.label,
          cancellationReason: reason,
          closedAt: cancelledAt,
          updatedAt: cancelledAt,
          auditLogIds: [...cut.auditLogIds, auditId],
        };

        await tx.upsert(StoreName.WAREHOUSE_INVENTORY_CUTS, cancelledCut);
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return cancelledCut;
      }
    );
  }
}
