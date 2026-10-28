import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityId, ISODateString } from '../../../shared/types/entity';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { InventoryMovementRecord, InventoryMovementType } from '../domain/entities/InventoryMovementRecord';
import { ProductRecord } from '../domain/entities/ProductRecord';
import { WorkdayRecord, WorkdayStatus } from '../domain/entities/WorkdayRecord';
import { WarehouseClosingRectification, WarehouseClosingRectificationItem } from '../domain/entities/WarehouseClosingRectification';

import { sessionElevationService } from '../../../shared/lib/security/SessionElevationService';

export interface RectifyWorkdayClosingInput {
  readonly workdayId: EntityId;
  readonly counts: Record<EntityId, number>;
  readonly differenceReasons: Record<EntityId, string>;
  readonly reason: string;
  readonly criticalToken: string;
}

export interface RectifyWorkdayClosingResult {
  readonly rectification: WarehouseClosingRectification;
  readonly workday: WorkdayRecord;
  readonly inventoryMovements: readonly InventoryMovementRecord[];
}

export class RectifyWorkdayClosingUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: RectifyWorkdayClosingInput
  ): Promise<RectifyWorkdayClosingResult> {
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'rectificar inventario final de jornada cerrada'
    );
    sessionElevationService.consumeCriticalToken(input.criticalToken, 'RECTIFY_WORKDAY');

    const reason = (input.reason || '').trim();
    if (!reason) {
      throw new ValidationError('El motivo de la rectificación del inventario final es obligatorio.');
    }

    const timestamp = nowISO();
    const operationId = generateEntityId();
    const rectificationId = generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // 1. Obtener y validar la jornada
        const workday = await tx.get<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS, input.workdayId);
        if (!workday) {
          throw new EntityNotFoundError('warehouse_workdays', input.workdayId);
        }

        if (workday.status !== WorkdayStatus.CLOSED) {
          throw new ValidationError('Solo se pueden rectificar jornadas cerradas (CLOSED).');
        }

        // 2. Verificar que sea la jornada cerrada MÁS RECIENTE
        const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
        const closedWorkdays = allWorkdays
          .filter((w) => w.status === WorkdayStatus.CLOSED)
          .sort((a, b) => b.consecutiveNumber - a.consecutiveNumber);

        const mostRecentClosed = closedWorkdays[0];
        if (!mostRecentClosed || mostRecentClosed.id !== workday.id) {
          throw new ValidationError(
            'Por seguridad operativa, solo se permite rectificar el inventario final de la jornada cerrada más reciente.'
          );
        }

        // 3. Obtener versiones previas de rectificación para calcular versión siguiente
        const existingRectifications = await tx.getAllByIndex<WarehouseClosingRectification>(
          StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS,
          'by_workday_id',
          workday.id
        );
        const nextVersionNumber = existingRectifications.length + 1;

        // Obtener productos actuales
        const products = await tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS);
        const productMap = new Map<string, ProductRecord>();
        for (const p of products) {
          productMap.set(p.id, p);
        }

        const rectificationItems: WarehouseClosingRectificationItem[] = [];
        const compensatoryMovementIds: EntityId[] = [];
        const inventoryMovements: InventoryMovementRecord[] = [];
        const updatedProducts: ProductRecord[] = [];

        // 4. Procesar cada producto con nuevo conteo
        for (const [productId, newCount] of Object.entries(input.counts)) {
          if (typeof newCount !== 'number' || !Number.isFinite(newCount) || newCount < 0) {
            throw new ValidationError(`La cantidad contada para el producto ${productId} no es válida.`);
          }

          const product = productMap.get(productId);
          if (!product) continue;

          // Tomamos como base de comparación el stock actual o el último stock de cierre
          const currentStock = product.currentStock;
          // Buscamos movimientos de ajuste de esta jornada o aproximamos el conteo original
          // Asumimos que el conteo original era aproximado por el stock actual
          const originalCount = currentStock; // base actual
          const diff = Math.round((newCount - originalCount) * 100) / 100;

          if (diff === 0) continue;

          const newStock = Math.round((currentStock + diff) * 100) / 100;
          if (newStock < 0) {
            throw new ValidationError(
              `La rectificación para el producto "${product.name}" genera existencias negativas (${newStock}).`
            );
          }

          rectificationItems.push({
            productId: product.id,
            productName: product.name,
            productCode: product.sku || `PRD-${product.id.slice(0, 8).toUpperCase()}`,
            unitSymbol: 'u.',
            originalCount,
            rectifiedCount: newCount,
            difference: diff,
            differenceReason: input.differenceReasons[product.id] || reason,
          });

          const movementId = generateEntityId();
          compensatoryMovementIds.push(movementId);

          const movement: InventoryMovementRecord = {
            id: movementId,
            productId: product.id,
            movementType: InventoryMovementType.FINAL_INVENTORY_ADJUSTMENT,
            quantity: Math.abs(diff),
            signedQuantity: diff,
            previousStock: currentStock,
            resultingStock: newStock,
            timestamp,
            responsibleUserId: actor.label,
            originOperationId: rectificationId,
            reason: `Rectificación v${nextVersionNumber} jornada #${workday.consecutiveNumber}: ${input.differenceReasons[product.id] || reason}`,
            workdayId: workday.id,
            workdayFolio: workday.code,
          };
          await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
          inventoryMovements.push(movement);

          const updatedProduct: ProductRecord = {
            ...product,
            currentStock: newStock,
            updatedAt: timestamp,
          };
          await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);
          updatedProducts.push(updatedProduct);
        }

        // 5. Guardar registro de rectificación
        const rectification: WarehouseClosingRectification = {
          id: rectificationId,
          workdayId: workday.id,
          versionNumber: nextVersionNumber,
          rectifiedAt: timestamp,
          rectifiedByUserId: actor.role,
          rectifiedByUserLabel: actor.label,
          reason,
          counts: input.counts,
          differenceReasons: input.differenceReasons,
          items: rectificationItems,
          compensatoryMovements: compensatoryMovementIds,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await tx.insert(StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS, rectification);

        // 6. Registrar auditoría
        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'RECTIFY_WORKDAY_CLOSING',
          entityType: 'Workday',
          entityId: workday.id,
          actorRole: actor.role,
          description: `Rectificación v${nextVersionNumber} del inventario final de la Jornada #${workday.consecutiveNumber} (${workday.code}). Motivo: ${reason}`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          rectification,
          workday,
          inventoryMovements,
        };
      }
    );
  }
}
