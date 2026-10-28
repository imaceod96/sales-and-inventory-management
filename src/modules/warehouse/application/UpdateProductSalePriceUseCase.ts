import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { resolveSalePrice } from '../../../shared/utils/money';
import { SaleRecord, SaleStatus, formatSaleDisplayLabel } from '../../sales/domain/entities/SaleRecord';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { PriceChangeRecord } from '../domain/entities/PriceChangeRecord';
import { ProductRecord } from '../domain/entities/ProductRecord';

export interface UpdateProductSalePriceInput {
  readonly productId: string;
  readonly newSalePrice: number;
  readonly reason: string;
  readonly operationId?: string;
}

export interface UpdateProductSalePriceResult {
  readonly product: ProductRecord;
  readonly priceChange: PriceChangeRecord;
  readonly isDuplicate?: boolean;
}

export class UpdateProductSalePriceUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: UpdateProductSalePriceInput
  ): Promise<UpdateProductSalePriceResult> {
    // 1. Autorización: sólo Administrador con permiso MANAGE_PRODUCTS
    assertPermission(actor, Permission.MANAGE_PRODUCTS, 'modificar precio de venta');

    // 2. Validación obligatoria del motivo
    const reason = (input.reason || '').trim();
    if (!reason) {
      throw new ValidationError('El motivo de la modificación del precio de venta es obligatorio.');
    }

    const timestamp = nowISO();
    const operationId = input.operationId || generateEntityId();
    const priceChangeId = generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_PRICE_CHANGES,
        StoreName.SALES_RECORDS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // Regla 19: Bloqueo de precio de venta si el producto está incluido en alguna cuenta abierta (SaleStatus.OPEN)
        const openSales = await tx.getAllByIndex<SaleRecord>(
          StoreName.SALES_RECORDS,
          'by_status',
          SaleStatus.OPEN
        );
        const containingOpenSales = openSales.filter((sale) =>
          (sale.items ?? []).some((item) => item.productId === input.productId)
        );
        if (containingOpenSales.length > 0) {
          const folios = containingOpenSales
            .map((s) => s.folio || formatSaleDisplayLabel(s) || `#${s.consecutiveNumber}`)
            .join(' y ');
          throw new ValidationError(
            `El precio de venta de este producto no puede modificarse porque está incluido en las cuentas abiertas ${folios}. Debes despachar, cancelar o retirar el producto de esas cuentas antes de cambiar su precio.`
          );
        }

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
            const changes = await tx.getAllByIndex<PriceChangeRecord>(
              StoreName.WAREHOUSE_PRICE_CHANGES,
              'by_product_id',
              input.productId
            );
            return {
              product: currentProd,
              priceChange: changes[changes.length - 1],
              isDuplicate: true,
            };
          }
        }

        // Obtener y validar producto existente
        const product = await tx.get<ProductRecord>(
          StoreName.WAREHOUSE_PRODUCTS,
          input.productId
        );
        if (!product) {
          throw new EntityNotFoundError('warehouse_products', input.productId);
        }

        // Validación y normalización a pesos enteros respetando último costo de compra
        const resolvedSalePrice = resolveSalePrice(input.newSalePrice, product.lastPurchasePrice);

        // Validar que el precio realmente haya cambiado
        if (resolvedSalePrice === product.currentSalePrice) {
          throw new ValidationError(
            `El nuevo precio de venta ($${resolvedSalePrice}) debe ser diferente al precio de venta actual ($${product.currentSalePrice}).`
          );
        }

        // Inmutabilidad: conservar existencias, último costo y estado administrativo
        const updatedProduct: ProductRecord = {
          ...product,
          currentSalePrice: resolvedSalePrice,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);

        // Registro inmutable de cambio de precio
        const priceChangeRecord: PriceChangeRecord = {
          id: priceChangeId,
          productId: product.id,
          previousSalePrice: product.currentSalePrice,
          newSalePrice: resolvedSalePrice,
          lastPurchasePrice: product.lastPurchasePrice,
          changedAt: timestamp,
          responsibleUserId: actor.label,
          reason,
        };
        await tx.insert(StoreName.WAREHOUSE_PRICE_CHANGES, priceChangeRecord);

        // Auditoría general
        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'UPDATE_PRODUCT_SALE_PRICE',
          entityType: 'Product',
          entityId: product.id,
          actorRole: actor.role,
          description: `Modificación independiente de precio de venta para "${product.name}": $${product.currentSalePrice} -> $${resolvedSalePrice}. Motivo: ${reason}`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          product: updatedProduct,
          priceChange: priceChangeRecord,
        };
      }
    );
  }
}
