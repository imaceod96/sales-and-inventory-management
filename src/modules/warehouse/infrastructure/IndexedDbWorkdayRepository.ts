import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { isOperativeWorkday, WorkdayRecord } from '../domain/entities/WorkdayRecord';
import { WorkdayRepository } from '../domain/repositories/WorkdayRepository';

export class IndexedDbWorkdayRepository implements WorkdayRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<WorkdayRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_WORKDAYS], 'readonly', async (tx) => {
      return tx.get<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS, id);
    });
  }

  public async findByCode(code: string): Promise<WorkdayRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_WORKDAYS], 'readonly', async (tx) => {
      const matches = await tx.getAllByIndex<WorkdayRecord>(
        StoreName.WAREHOUSE_WORKDAYS,
        'by_code',
        code
      );
      return matches[0];
    });
  }

  public async findActiveWorkday(): Promise<WorkdayRecord | undefined> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_WORKDAYS], 'readonly', async (tx) => {
      const all = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
      return all.find((w) => isOperativeWorkday(w.status));
    });
  }

  public async findAll(): Promise<WorkdayRecord[]> {
    return this.engine.runTransaction([StoreName.WAREHOUSE_WORKDAYS], 'readonly', async (tx) => {
      const records = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
      return records.slice().sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    });
  }

  public async save(workday: WorkdayRecord): Promise<void> {
    await this.engine.runTransaction([StoreName.WAREHOUSE_WORKDAYS], 'readwrite', async (tx) => {
      await tx.upsert(StoreName.WAREHOUSE_WORKDAYS, workday);
    });
  }
}
