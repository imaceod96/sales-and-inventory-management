import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { normalizeName } from '../../../shared/utils/string';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { OperationLogRepository } from '../../core/domain/repositories/OperationLogRepository';
import { CategoryRecord } from '../domain/entities/CategoryRecord';
import { CategoryRepository } from '../domain/repositories/CategoryRepository';

export interface CreateCategoryInput {
  readonly name: string;
}

export class CreateCategoryUseCase {
  private readonly categoryRepository: CategoryRepository;
  private readonly operationLogRepository: OperationLogRepository;

  constructor(
    categoryRepository: CategoryRepository,
    operationLogRepository: OperationLogRepository
  ) {
    this.categoryRepository = categoryRepository;
    this.operationLogRepository = operationLogRepository;
  }

  public async execute(actor: SessionActor, input: CreateCategoryInput): Promise<CategoryRecord> {
    assertPermission(actor, Permission.MANAGE_PRODUCTS, 'crear categoría de producto');

    const trimmedName = (input.name || '').trim();
    if (!trimmedName) {
      throw new ValidationError('El nombre de la categoría es obligatorio.');
    }

    const normalized = normalizeName(trimmedName);
    const existing = await this.categoryRepository.findByNormalizedName(normalized);
    if (existing) {
      throw new ValidationError(`Ya existe una categoría con el nombre "${trimmedName}".`);
    }

    const timestamp = nowISO();
    const category: CategoryRecord = {
      id: generateEntityId(),
      name: trimmedName,
      normalizedName: normalized,
      createdAt: timestamp,
    };

    await this.categoryRepository.save(category);

    const auditEntry: OperationLogEntry = {
      id: generateEntityId(),
      module: OperationModule.WAREHOUSE,
      action: 'CREATE_CATEGORY',
      entityType: 'Category',
      entityId: category.id,
      actorRole: actor.role,
      description: `Creación de categoría "${category.name}".`,
      createdAt: timestamp,
    };

    await this.operationLogRepository.record(auditEntry);

    return category;
  }
}
