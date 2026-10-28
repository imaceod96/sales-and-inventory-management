import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { MeasurementUnitRecord } from '../domain/entities/MeasurementUnitRecord';
import { MeasurementUnitRepository } from '../domain/repositories/MeasurementUnitRepository';

export class ListMeasurementUnitsUseCase {
  private readonly unitRepository: MeasurementUnitRepository;

  constructor(unitRepository: MeasurementUnitRepository) {
    this.unitRepository = unitRepository;
  }

  public async execute(actor: SessionActor): Promise<MeasurementUnitRecord[]> {
    assertPermission(actor, Permission.VIEW_PRODUCTS, 'consultar unidades de medida');
    return this.unitRepository.findAll();
  }
}
