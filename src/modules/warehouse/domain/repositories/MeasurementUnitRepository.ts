import { EntityId } from '../../../../shared/types/entity';
import { MeasurementUnitRecord } from '../entities/MeasurementUnitRecord';

export interface MeasurementUnitRepository {
  findById(id: EntityId): Promise<MeasurementUnitRecord | undefined>;
  findByNormalizedName(normalizedName: string): Promise<MeasurementUnitRecord | undefined>;
  findAll(): Promise<MeasurementUnitRecord[]>;
  save(unit: MeasurementUnitRecord): Promise<void>;
}
