import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { OperationLogEntry } from '../domain/entities/OperationLog';
import { OperationLogRepository } from '../domain/repositories/OperationLogRepository';

export class IndexedDbOperationLogRepository implements OperationLogRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async record(entry: OperationLogEntry): Promise<void> {
    await this.engine.runTransaction([StoreName.OPERATION_HISTORY], 'readwrite', async (tx) => {
      await tx.insert(StoreName.OPERATION_HISTORY, entry);
    });
  }

  public async findRecent(limit = 50): Promise<OperationLogEntry[]> {
    return this.engine.runTransaction([StoreName.OPERATION_HISTORY], 'readonly', async (tx) => {
      const entries = await tx.getAll<OperationLogEntry>(StoreName.OPERATION_HISTORY);
      return entries
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    });
  }

  public async count(): Promise<number> {
    return this.engine.runTransaction([StoreName.OPERATION_HISTORY], 'readonly', async (tx) => {
      return tx.count(StoreName.OPERATION_HISTORY);
    });
  }
}
