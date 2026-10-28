import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { normalizeName } from '../../../shared/utils/string';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { OperationLogRepository } from '../../core/domain/repositories/OperationLogRepository';
import { MeasurementUnitRecord } from '../domain/entities/MeasurementUnitRecord';
import { MeasurementUnitRepository } from '../domain/repositories/MeasurementUnitRepository';

export interface CreateMeasurementUnitInput {
  readonly name: string;
}

export class CreateMeasurementUnitUseCase {
  private readonly unitRepository: MeasurementUnitRepository;
  private readonly operationLogRepository: OperationLogRepository;

  constructor(
    unitRepository: MeasurementUnitRepository,
    operationLogRepository: OperationLogRepository
  ) {
    this.unitRepository = unitRepository;
    this.operationLogRepository = operationLogRepository;
  }

  public async execute(
    actor: SessionActor,
    input: CreateMeasurementUnitInput
  ): Promise<MeasurementUnitRecord> {
    assertPermission(actor, Permission.MANAGE_PRODUCTS, 'crear unidad de medida');

    const trimmedName = (input.name || '').trim();
    if (!trimmedName) {
      throw new ValidationError('El nombre de la unidad de medida es obligatorio.');
    }

    const normalized = normalizeName(trimmedName);
    const existing = await this.unitRepository.findByNormalizedName(normalized);
    if (existing) {
      throw new ValidationError(`Ya existe una unidad de medida con el nombre "${trimmedName}".`);
    }

    const timestamp = nowISO();
    const unit: MeasurementUnitRecord = {
      id: generateEntityId(),
      name: trimmedName,
      normalizedName: normalized,
      createdAt: timestamp,
    };

    await this.unitRepository.save(unit);

    const auditEntry: OperationLogEntry = {
      id: generateEntityId(),
      module: OperationModule.WAREHOUSE,
      action: 'CREATE_MEASUREMENT_UNIT',
      entityType: 'MeasurementUnit',
      entityId: unit.id,
      actorRole: actor.role,
      description: `Creación de unidad de medida "${unit.name}".`,
      createdAt: timestamp,
    };

    await this.operationLogRepository.record(auditEntry);

    return unit;
  }
}
