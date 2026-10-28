import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { ProductRecord, ProductStatus } from '../domain/entities/ProductRecord';
import { ProductStatusChangeRecord } from '../domain/entities/ProductStatusChangeRecord';

export interface DeactivateProductInput {
  readonly productId: string;
  readonly reason: string;
  readonly operationId?: string;
}

export interface DeactivateProductResult {
  readonly product: ProductRecord;
  readonly statusChange: ProductStatusChangeRecord;
  readonly isDuplicate?: boolean;
}

export class DeactivateProductUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: DeactivateProductInput
  ): Promise<DeactivateProductResult> {
    // 1. Autorización: sólo Administrador con permiso MANAGE_PRODUCTS
    assertPermission(actor, Permission.MANAGE_PRODUCTS, 'desactivar producto');

    // 2. Validación obligatoria del motivo
    const reason = (input.reason || '').trim();
    if (!reason) {
      throw new ValidationError('El motivo de la desactivación es obligatorio.');
    }

    const timestamp = nowISO();
    const operationId = input.operationId || generateEntityId();
    const statusChangeId = generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // Idempotencia: si la operación ya se ejecutó con este ID
        const existingOp = await tx.get<OperationLogEntry>(
          StoreName.OPERATION_HISTORY,
          operationId
        );
        if (existingOp) {
          const currentProd = await tx.get<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            input.productId
          );
          if (currentProd) {
            const changes = await tx.getAllByIndex<ProductStatusChangeRecord>(
              StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES,
              'by_product_id',
              input.productId
            );
            return {
              product: currentProd,
              statusChange: changes[changes.length - 1],
              isDuplicate: true,
            };
          }
        }

        // Obtener producto existente
        const product = await tx.get<ProductRecord>(
          StoreName.WAREHOUSE_PRODUCTS,
          input.productId
        );
        if (!product) {
          throw new EntityNotFoundError('warehouse_products', input.productId);
        }

        // Validación de estado actual
        if (product.status === ProductStatus.INACTIVE) {
          throw new ValidationError(`El producto "${product.name}" ya se encuentra inactivo.`);
        }

        // Inmutabilidad: conservar existencias, último costo y precio de venta íntegros
        const updatedProduct: ProductRecord = {
          ...product,
          status: ProductStatus.INACTIVE,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);

        // Registro de cambio de estado
        const statusChangeRecord: ProductStatusChangeRecord = {
          id: statusChangeId,
          productId: product.id,
          previousStatus: ProductStatus.ACTIVE,
          newStatus: ProductStatus.INACTIVE,
          changedAt: timestamp,
          responsibleUserId: actor.label,
          reason,
        };
        await tx.insert(StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES, statusChangeRecord);

        // Auditoría general
        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'DEACTIVATE_PRODUCT',
          entityType: 'Product',
          entityId: product.id,
          actorRole: actor.role,
          description: `Desactivación de producto "${product.name}". Motivo: ${reason}`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          product: updatedProduct,
          statusChange: statusChangeRecord,
        };
      }
    );
  }
}
