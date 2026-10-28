import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import {
  InventoryMovementRecord,
  InventoryMovementType,
} from '../domain/entities/InventoryMovementRecord';
import { ProductRecord } from '../domain/entities/ProductRecord';

export interface CorrectProductStockInput {
  readonly productId: string;
  readonly realPhysicalStock: number;
  readonly expectedPreviousStock?: number;
  readonly expectedUpdatedAt?: string;
  readonly reason: string;
  readonly operationId?: string;
}

export interface CorrectProductStockResult {
  readonly product: ProductRecord;
  readonly movement: InventoryMovementRecord;
  readonly difference: number;
  readonly isDuplicate?: boolean;
}

export class CorrectProductStockUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: CorrectProductStockInput
  ): Promise<CorrectProductStockResult> {
    // 1. Autorización: solo Administrador con permiso MANAGE_PRODUCTS
    assertPermission(actor, Permission.MANAGE_PRODUCTS, 'corregir existencias de inventario');

    // 2. Validación obligatoria del motivo
    const reason = (input.reason || '').trim();
    if (!reason) {
      throw new ValidationError('El motivo de la corrección de existencias es obligatorio.');
    }

    // 3. Validación numérica de la cantidad física declarada
    if (typeof input.realPhysicalStock !== 'number' || !Number.isFinite(input.realPhysicalStock)) {
      throw new ValidationError('La existencia física real debe ser un valor numérico válido.');
    }

    if (input.realPhysicalStock < 0) {
      throw new ValidationError('La existencia física real no puede ser negativa.');
    }

    const decimalsPart = (input.realPhysicalStock.toString().split('.')[1] || '').length;
    if (decimalsPart > 2) {
      throw new ValidationError('La existencia física real admite como máximo dos decimales.');
    }

    if (input.realPhysicalStock > 9999999.99) {
      throw new ValidationError('La existencia física real excede el límite numérico admitido.');
    }

    const normalizedPhysicalStock = Math.round(input.realPhysicalStock * 100) / 100;
    const timestamp = nowISO();
    const operationId = input.operationId || generateEntityId();
    const movementId = generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // Idempotencia: si la operación ya se registró con este ID, no duplicar
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
            const movements = await tx.getAllByIndex<InventoryMovementRecord>(
              StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
              'by_product_id',
              input.productId
            );
            const latestMovement = movements[movements.length - 1];
            return {
              product: currentProd,
              movement: latestMovement,
              difference: 0,
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

        // Protección frente a existencias obsoletas (Control de concurrencia)
        if (
          input.expectedPreviousStock !== undefined &&
          Math.abs(product.currentStock - input.expectedPreviousStock) > 0.0001
        ) {
          throw new ValidationError(
            `Las existencias del producto han cambiado (${input.expectedPreviousStock} -> ${product.currentStock}) desde que se abrió el formulario. Actualice los datos antes de aplicar la corrección.`
          );
        }

        if (input.expectedUpdatedAt && product.updatedAt !== input.expectedUpdatedAt) {
          throw new ValidationError(
            'El producto fue actualizado por otra operación. Actualice los datos antes de aplicar la corrección.'
          );
        }

        // Cálculo de diferencia y validación de cambio
        const previousStock = product.currentStock;
        const difference = Math.round((normalizedPhysicalStock - previousStock) * 100) / 100;

        if (Math.abs(difference) < 0.0001) {
          throw new ValidationError(
            'La existencia física declarada es idéntica a la existencia registrada actual. No hay diferencia para corregir.'
          );
        }

        const movementType =
          difference > 0
            ? InventoryMovementType.CORRECTION_POSITIVE
            : InventoryMovementType.CORRECTION_NEGATIVE;

        // Actualización inmutable del producto (preserva nombre, SKU, categoría, unidad, costo y precio)
        const updatedProduct: ProductRecord = {
          ...product,
          currentStock: normalizedPhysicalStock,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);

        // Registro de movimiento compensatorio en kardex
        const movement: InventoryMovementRecord = {
          id: movementId,
          productId: product.id,
          movementType,
          quantity: Math.abs(difference),
          previousStock,
          resultingStock: normalizedPhysicalStock,
          timestamp,
          responsibleUserId: actor.label,
          originOperationId: operationId,
          reason,
        };
        await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);

        // Registro de auditoría
        const diffSign = difference > 0 ? `+${difference}` : `${difference}`;
        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'CORRECT_INVENTORY_STOCK',
          entityType: 'Product',
          entityId: product.id,
          actorRole: actor.role,
          description: `Corrección de inventario para "${product.name}": existencia regularizada de ${previousStock} a ${normalizedPhysicalStock} (${diffSign}). Motivo: ${reason}`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          product: updatedProduct,
          movement,
          difference,
        };
      }
    );
  }
}
