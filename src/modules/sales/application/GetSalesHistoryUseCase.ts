import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { SaleBaseRecord } from '../domain/entities/SaleRecord';
import { SaleRepository } from '../domain/repositories/SaleRepository';

export class GetSalesHistoryUseCase {
  private readonly saleRepository: SaleRepository;

  constructor(saleRepository: SaleRepository) {
    this.saleRepository = saleRepository;
  }

  public async execute(actor: SessionActor): Promise<SaleBaseRecord[]> {
    assertPermission(actor, Permission.VIEW_SALES_HISTORY, 'consultar historial de ventas');
    return this.saleRepository.findClosedSales(200);
  }
}
