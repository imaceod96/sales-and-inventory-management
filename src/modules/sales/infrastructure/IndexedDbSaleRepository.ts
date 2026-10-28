import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId } from '../../../shared/types/entity';
import { SaleRecord, SaleStatus } from '../domain/entities/SaleRecord';
import { SaleRepository } from '../domain/repositories/SaleRepository';

export class IndexedDbSaleRepository implements SaleRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async findById(id: EntityId): Promise<SaleRecord | undefined> {
    return this.engine.runTransaction([StoreName.SALES_RECORDS], 'readonly', async (tx) => {
      return tx.get<SaleRecord>(StoreName.SALES_RECORDS, id);
    });
  }

  public async findAll(): Promise<SaleRecord[]> {
    return this.engine.runTransaction([StoreName.SALES_RECORDS], 'readonly', async (tx) => {
      const records = await tx.getAll<SaleRecord>(StoreName.SALES_RECORDS);
      return records.slice().sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    });
  }

  public async count(): Promise<number> {
    return this.engine.runTransaction([StoreName.SALES_RECORDS], 'readonly', async (tx) => {
      return tx.count(StoreName.SALES_RECORDS);
    });
  }

  public async findOpenSales(): Promise<SaleRecord[]> {
    return this.engine.runTransaction([StoreName.SALES_RECORDS], 'readonly', async (tx) => {
      const records = await tx.getAllByIndex<SaleRecord>(
        StoreName.SALES_RECORDS,
        'by_status',
        SaleStatus.OPEN
      );
      return records.slice().sort((a, b) => {
        const numA = a.consecutiveNumber ?? Number.MAX_SAFE_INTEGER;
        const numB = b.consecutiveNumber ?? Number.MAX_SAFE_INTEGER;
        if (numA !== numB) return numA - numB;
        return a.openedAt.localeCompare(b.openedAt);
      });
    });
  }

  public async findOpenSaleById(id: EntityId): Promise<SaleRecord | undefined> {
    const sale = await this.findById(id);
    if (!sale || sale.status !== SaleStatus.OPEN) {
      return undefined;
    }
    return sale;
  }

  public async findClosedSales(limit = 50): Promise<SaleRecord[]> {
    return this.engine.runTransaction([StoreName.SALES_RECORDS], 'readonly', async (tx) => {
      const allSales = await tx.getAll<SaleRecord>(StoreName.SALES_RECORDS);
      return allSales
        .filter((sale) => sale.status !== SaleStatus.OPEN)
        .sort((a, b) =>
          (b.dispatchedAt ?? b.cancelledAt ?? b.closedAt ?? b.updatedAt).localeCompare(
            a.dispatchedAt ?? a.cancelledAt ?? a.closedAt ?? a.updatedAt
          )
        )
        .slice(0, limit);
    });
  }

  public async findDispatchedSalesByWorkdayId(workdayId: EntityId): Promise<SaleRecord[]> {
    return this.engine.runTransaction([StoreName.SALES_RECORDS], 'readonly', async (tx) => {
      const allSales = await tx.getAll<SaleRecord>(StoreName.SALES_RECORDS);
      return allSales
        .filter(
          (sale) =>
            (sale.status === SaleStatus.DISPATCHED ||
              (sale.status as string) === 'COMPLETED') &&
            (sale.dispatchedWorkdayId === workdayId ||
              sale.workdayId === workdayId ||
              sale.createdWorkdayId === workdayId)
        )
        .sort((a, b) =>
          (b.dispatchedAt ?? b.closedAt ?? b.updatedAt).localeCompare(
            a.dispatchedAt ?? a.closedAt ?? a.updatedAt
          )
        );
    });
  }
}
