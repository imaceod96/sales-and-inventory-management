import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { CategoryRecord } from '../domain/entities/CategoryRecord';
import { CategoryRepository } from '../domain/repositories/CategoryRepository';

export class ListCategoriesUseCase {
  private readonly categoryRepository: CategoryRepository;

  constructor(categoryRepository: CategoryRepository) {
    this.categoryRepository = categoryRepository;
  }

  public async execute(actor: SessionActor): Promise<CategoryRecord[]> {
    assertPermission(actor, Permission.VIEW_PRODUCTS, 'consultar categorías de producto');
    return this.categoryRepository.findAll();
  }
}
