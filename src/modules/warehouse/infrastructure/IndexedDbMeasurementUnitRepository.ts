import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { MeasurementUnitRecord } from '../domain/entities/MeasurementUnitRecord';
import { MeasurementUnitRepository } from '../domain/repositories/MeasurementUnitRepository';

export class IndexedDbMeasurementUnitRepository implements MeasurementUnitRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<MeasurementUnitRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_UNITS], 'readonly', async (tx) => {
      return tx.get<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS, id);
    });
  }

  public async findByNormalizedName(
    normalizedName: string
  ): Promise<MeasurementUnitRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_UNITS], 'readonly', async (tx) => {
      const matches = await tx.getAllByIndex<MeasurementUnitRecord>(
        StoreName.WAREHOUSE_UNITS,
        'by_normalized_name',
        normalizedName
      );
      return matches[0];
    });
  }

  public async findAll(): Promise<MeasurementUnitRecord[]> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_UNITS], 'readonly', async (tx) => {
      const records = await tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS);
      return records.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    });
  }

  public async save(unit: MeasurementUnitRecord): Promise<void> {
    await this.engine.runTransaction([StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_UNITS, unit);
    });
  }
}
