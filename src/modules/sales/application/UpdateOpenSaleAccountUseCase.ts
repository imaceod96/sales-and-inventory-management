import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { MeasurementUnitRecord } from '../../warehouse/domain/entities/MeasurementUnitRecord';
import { ProductRecord, ProductStatus } from '../../warehouse/domain/entities/ProductRecord';
import {
  isOperativeWorkday,
  validateActiveWorkdayForSales,
  WorkdayRecord,
} from '../../warehouse/domain/entities/WorkdayRecord';
import {
  consolidateSaleLineInputs,
  SaleLineDraftInput,
  SaleLineItemRecord,
  SaleRecord,
  SaleStatus,
} from '../domain/entities/SaleRecord';

export interface UpdateOpenSaleAccountInput {
  readonly saleId: string;
  readonly accountName?: string;
  readonly items: readonly SaleLineDraftInput[];
  readonly expectedUpdatedAt?: string;
  readonly syncToCatalogPrices?: boolean;
  readonly operationId?: string;
}

export interface UpdateOpenSaleAccountResult {
  readonly sale: SaleRecord;
  readonly isDuplicate?: boolean;
}

export class UpdateOpenSaleAccountUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: UpdateOpenSaleAccountInput
  ): Promise<UpdateOpenSaleAccountResult> {
    assertPermission(actor, Permission.CREATE_SALE, 'editar una cuenta abierta');

    const saleId = (input.saleId || '').trim();
    if (!saleId) {
      throw new ValidationError('El identificador de la cuenta abierta es obligatorio.');
    }

    const consolidatedLines = consolidateSaleLineInputs(input.items);
    const timestamp = nowISO();
    const auditId = input.operationId || generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_UNITS,
        StoreName.SALES_RECORDS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // Idempotencia por auditId
        const existingOp = await tx.get<OperationLogEntry>(
          StoreName.OPERATION_HISTORY,
          auditId
        );
        if (existingOp && existingOp.entityId) {
          const existingSale = await tx.get<SaleRecord>(
            StoreName.SALES_RECORDS,
            existingOp.entityId
          );
          if (existingSale) {
            return {
              sale: existingSale,
              isDuplicate: true,
            };
          }
        }

        // 1. Validar jornada activa
        const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
        const activeWorkday =
          allWorkdays.find((w) => isOperativeWorkday(w.status)) ?? null;
        const salesValidation = validateActiveWorkdayForSales(activeWorkday);

        if (!salesValidation.canOperateSales || !salesValidation.activeWorkday) {
          throw new ValidationError(
            salesValidation.message ||
              'No hay una jornada abierta habilitada para modificar cuentas abiertas.'
          );
        }

        // 2. Obtener y verificar estado de la cuenta abierta
        const existingSale = await tx.get<SaleRecord>(StoreName.SALES_RECORDS, saleId);
        if (!existingSale) {
          throw new EntityNotFoundError('sales_records', saleId);
        }

        if (existingSale.status !== SaleStatus.OPEN) {
          throw new ValidationError(
            existingSale.status === SaleStatus.DISPATCHED
              ? 'No es posible editar una cuenta que ya fue despachada.'
              : 'No es posible editar una cuenta que fue cancelada.'
          );
        }

        // 3. Control de concurrencia optimista
        if (
          input.expectedUpdatedAt &&
          existingSale.updatedAt !== input.expectedUpdatedAt
        ) {
          throw new ValidationError(
            'La cuenta abierta fue modificada recientemente por otra operación. Actualiza la vista antes de guardar los cambios.'
          );
        }

        // 4. Validar nombre de la cuenta
        const nextAccountName =
          input.accountName !== undefined
            ? input.accountName.trim()
            : (existingSale.accountName ?? existingSale.customerOrTableLabel ?? '').trim();

        if (!nextAccountName) {
          throw new ValidationError(
            'El nombre de la cuenta abierta no puede quedar vacío.'
          );
        }

        if (nextAccountName.length > 80) {
          throw new ValidationError(
            'El nombre de la cuenta abierta no puede exceder 80 caracteres.'
          );
        }

        // 5. Validar productos y existencias disponibles (sin descontar stock)
        const allUnits = await tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS);
        const unitMap = new Map<string, MeasurementUnitRecord>();
        for (const u of allUnits) {
          unitMap.set(u.id, u);
        }

        const existingPriceByProduct = new Map<string, number>();
        for (const item of existingSale.items ?? []) {
          existingPriceByProduct.set(item.productId, item.unitSalePrice);
        }

        const lineItems: SaleLineItemRecord[] = [];
        let totalAmount = 0;

        for (const draftLine of consolidatedLines) {
          const product = await tx.get<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            draftLine.productId
          );
          if (!product) {
            throw new EntityNotFoundError('warehouse_products', draftLine.productId);
          }

          if (product.status !== ProductStatus.ACTIVE) {
            throw new ValidationError(
              `El producto "${product.name}" se encuentra inactivo. Debes retirarlo de la cuenta para poder guardar o despachar.`
            );
          }

          if (product.currentStock <= 0) {
            throw new ValidationError(
              `El producto "${product.name}" se encuentra agotado en almacén.`
            );
          }

          if (draftLine.quantity > product.currentStock) {
            throw new ValidationError(
              `La cantidad solicitada para "${product.name}" (${draftLine.quantity}) supera las existencias disponibles (${product.currentStock}).`
            );
          }

          const unit = unitMap.get(product.measurementUnitId);
          const unitSalePrice =
            input.syncToCatalogPrices !== false
              ? product.currentSalePrice
              : (draftLine.customUnitSalePrice ??
                existingPriceByProduct.get(product.id) ??
                product.currentSalePrice);

          const lineSubtotal =
            Math.round(draftLine.quantity * unitSalePrice * 100) / 100;

          lineItems.push({
            productId: product.id,
            productCode: product.sku ?? `PRD-${product.id.slice(0, 8).toUpperCase()}`,
            sku: product.sku ?? null,
            productName: product.name,
            measurementUnitId: product.measurementUnitId,
            unitName: unit?.name ?? 'Unidad',
            unitSymbol: unit?.name ?? 'u.',
            quantity: draftLine.quantity,
            unitSalePrice,
            lineSubtotal,
          });

          totalAmount = Math.round((totalAmount + lineSubtotal) * 100) / 100;
        }

        const updatedSale: SaleRecord = {
          ...existingSale,
          accountName: nextAccountName,
          customerOrTableLabel: nextAccountName,
          items: lineItems,
          totalAmount,
          hasStockMovement: false,
          updatedAt: timestamp,
        };

        await tx.upsert(StoreName.SALES_RECORDS, updatedSale);

        const auditEntry: OperationLogEntry = {
          id: auditId,
          module: OperationModule.SALES,
          action: 'UPDATE_OPEN_SALE_ACCOUNT',
          entityType: 'Sale',
          entityId: updatedSale.id,
          actorRole: actor.role,
          description: `Actualización de cuenta abierta ${updatedSale.folio} — ${nextAccountName} (${lineItems.length} partida(s), importe actualizado $${totalAmount.toFixed(2)}).`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          sale: updatedSale,
        };
      }
    );
  }
}
