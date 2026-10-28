import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { InventoryCutBaseRecord } from '../domain/entities/InventoryCutRecord';
import { InventoryCutRepository } from '../domain/repositories/InventoryCutRepository';

export class ListInventoryCutsUseCase {
  private readonly inventoryCutRepository: InventoryCutRepository;

  constructor(inventoryCutRepository: InventoryCutRepository) {
    this.inventoryCutRepository = inventoryCutRepository;
  }

  public async execute(actor: SessionActor): Promise<InventoryCutBaseRecord[]> {
    assertPermission(
      actor,
      Permission.VIEW_INVENTORY_CUTS,
      'consultar cortes de inventario'
    );
    return this.inventoryCutRepository.findAll();
  }
}
