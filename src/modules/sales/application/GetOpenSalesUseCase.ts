import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { SaleBaseRecord } from '../domain/entities/SaleRecord';
import { SaleRepository } from '../domain/repositories/SaleRepository';

export class GetOpenSalesUseCase {
  private readonly saleRepository: SaleRepository;

  constructor(saleRepository: SaleRepository) {
    this.saleRepository = saleRepository;
  }

  public async execute(actor: SessionActor): Promise<SaleBaseRecord[]> {
    assertPermission(actor, Permission.VIEW_OPEN_SALES, 'consultar ventas abiertas');
    return this.saleRepository.findOpenSales();
  }
}
