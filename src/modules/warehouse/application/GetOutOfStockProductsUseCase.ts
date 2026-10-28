import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import {
  calculateProductAvailability,
  ProductAvailability,
  ProductRecord,
  ProductStatus,
} from '../domain/entities/ProductRecord';
import { CategoryRepository } from '../domain/repositories/CategoryRepository';
import { ProductRepository } from '../domain/repositories/ProductRepository';

export interface OutOfStockProductItem {
  readonly id: string;
  readonly code: string;
  readonly sku: string | null;
  readonly name: string;
  readonly categoryName: string;
  readonly currentStock: number;
  readonly salePrice: number;
}

export class GetOutOfStockProductsUseCase {
  private readonly productRepository: ProductRepository;
  private readonly categoryRepository: CategoryRepository;

  constructor(
    productRepository: ProductRepository,
    categoryRepository: CategoryRepository
  ) {
    this.productRepository = productRepository;
    this.categoryRepository = categoryRepository;
  }

  public async execute(actor: SessionActor): Promise<OutOfStockProductItem[]> {
    // Autorización: visible tanto para Administrador como para Cajero
    assertPermission(actor, Permission.VIEW_PRODUCTS, 'consultar productos agotados');

    const [allProducts, allCategories] = await Promise.all([
      this.productRepository.findAll(),
      this.categoryRepository.findAll(),
    ]);

    const categoryMap = new Map<string, string>();
    for (const cat of allCategories) {
      categoryMap.set(cat.id, cat.name);
    }

    // Filtrar estrictamente productos ACTIVOS y con existencia 0
    // Reutilizando la regla de negocio de disponibilidad del dominio
    const outOfStockProducts: OutOfStockProductItem[] = [];

    for (const prod of allProducts) {
      if (prod.status !== ProductStatus.ACTIVE) {
        continue;
      }

      const availability = calculateProductAvailability(prod.status, prod.currentStock);
      if (availability === ProductAvailability.OUT_OF_STOCK) {
        outOfStockProducts.push({
          id: prod.id,
          code: (prod as ProductRecord & { code?: string }).code || `PRD-${prod.id.slice(0, 6)}`,
          sku: prod.sku,
          name: prod.name,
          categoryName: categoryMap.get(prod.categoryId) || 'Sin categoría',
          currentStock: prod.currentStock,
          salePrice: prod.currentSalePrice,
        });
      }
    }

    // Ordenar alfabéticamente por nombre
    return outOfStockProducts.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }
}
