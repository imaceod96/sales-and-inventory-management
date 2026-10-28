import { EntityId } from '../../../../shared/types/entity';
import { Repository } from '../../../../shared/types/repository';
import { SaleBaseRecord, SaleRecord } from '../entities/SaleRecord';

export interface SaleRepository extends Repository<SaleBaseRecord> {
  findOpenSales(): Promise<SaleRecord[]>;
  findOpenSaleById(id: EntityId): Promise<SaleRecord | undefined>;
  findClosedSales(limit?: number): Promise<SaleRecord[]>;
  findDispatchedSalesByWorkdayId(workdayId: EntityId): Promise<SaleRecord[]>;
}
