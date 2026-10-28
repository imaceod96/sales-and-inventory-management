import { IndexedDbEngine } from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { EntityId, ISODateString } from '../../../shared/types/entity';
import { SaleBaseRecord, SaleRecord, SaleStatus } from '../../sales/domain/entities/SaleRecord';
import { computeCommercialActivitySummaryFromSales } from '../domain/entities/InventoryCutRecord';
import {
  AffectedCommercialProduct,
  CommercialActivityIntervalQueryResult,
  CommercialActivityQueryPort,
} from '../domain/ports/CommercialActivityQueryPort';

export interface CommercialSaleLineCandidate {
  readonly productId: EntityId;
  readonly quantity: number;
  readonly unitSalePrice?: number;
  readonly lineSubtotal?: number;
}

export interface ConfirmedSaleWithItemsCandidate extends Omit<SaleBaseRecord, 'items'> {
  readonly items?: readonly CommercialSaleLineCandidate[];
  readonly lines?: readonly CommercialSaleLineCandidate[];
  readonly cancelledAt?: ISODateString | null;
  readonly returnedAt?: ISODateString | null;
  /**
   * Para operaciones CANCELLED:
   * - En cuentas abiertas canceladas antes de despachar, hasStockMovement es false, por lo que NO se incluyen.
   * - Solo una devolución/anulación futura con movimiento real de existencias (hasStockMovement === true) se incluiría.
   */
  readonly hasStockMovement?: boolean;
}

/**
 * Adaptador IndexedDB del contrato de lectura de actividad comercial por intervalo.
 *
 * Inspecciona únicamente registros reales de ventas despachadas (DISPATCHED) y devoluciones/anulaciones
 * con movimientos reales de existencias vinculadas al workdayId de despacho dentro del intervalo.
 * Ignora cuentas en estado OPEN y cuentas abiertas canceladas sin movimiento de stock.
 */
export class IndexedDbCommercialActivityAdapter implements CommercialActivityQueryPort {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async queryAffectedProductsInInterval(params: {
    readonly workdayId: EntityId;
    readonly intervalStartAt: ISODateString;
    readonly intervalEndAt: ISODateString;
    readonly isInitialWorkdayInterval?: boolean;
  }): Promise<CommercialActivityIntervalQueryResult> {
    const {
      workdayId,
      intervalStartAt,
      intervalEndAt,
      isInitialWorkdayInterval = false,
    } = params;

    return this.engine.runTransaction([StoreName.SALES_RECORDS], 'readonly', async (tx) => {
      const allSales = await tx.getAll<ConfirmedSaleWithItemsCandidate>(StoreName.SALES_RECORDS);

      // Filtrar exclusivamente ventas despachadas (DISPATCHED / COMPLETED) o anulaciones con movimiento real de stock
      // cuyo despacho haya ocurrido en esta jornada y dentro del intervalo correspondiente.
      // Nunca se utiliza `openedAt` como fecha de venta para cuentas despachadas.
      const validSalesInInterval = allSales.filter((sale) => {
        const effectiveWorkdayId = sale.dispatchedWorkdayId ?? sale.workdayId;
        if (effectiveWorkdayId && effectiveWorkdayId !== workdayId) return false;

        const isDispatchedSale =
          sale.status === SaleStatus.DISPATCHED ||
          (sale.status as string) === 'COMPLETED';
        const isCancelledOrReturnWithStockMovement =
          sale.status === SaleStatus.CANCELLED && sale.hasStockMovement === true;

        if (!isDispatchedSale && !isCancelledOrReturnWithStockMovement) {
          return false;
        }

        const effectiveTimestamp =
          sale.status === SaleStatus.CANCELLED
            ? sale.cancelledAt ?? sale.returnedAt ?? sale.closedAt ?? sale.updatedAt
            : sale.dispatchedAt ?? sale.closedAt;

        if (!effectiveTimestamp) return false;

        const afterStart = isInitialWorkdayInterval
          ? effectiveTimestamp >= intervalStartAt
          : effectiveTimestamp > intervalStartAt;
        const beforeOrAtEnd = effectiveTimestamp <= intervalEndAt;

        return afterStart && beforeOrAtEnd;
      });

      const productMap = new Map<
        EntityId,
        {
          operationIds: Set<string>;
          lastOperationAt: ISODateString;
          operationTimestamps: Set<ISODateString>;
        }
      >();

      for (const sale of validSalesInInterval) {
        const lineItems = sale.items ?? sale.lines ?? [];
        if (!Array.isArray(lineItems)) continue;

        const saleTime =
          (sale.status === SaleStatus.CANCELLED
            ? sale.cancelledAt ?? sale.returnedAt ?? sale.closedAt ?? sale.updatedAt
            : sale.dispatchedAt ?? sale.closedAt) || intervalEndAt;

        for (const line of lineItems) {
          if (!line.productId || typeof line.quantity !== 'number' || line.quantity <= 0) {
            continue;
          }
          const existing = productMap.get(line.productId);
          if (!existing) {
            productMap.set(line.productId, {
              operationIds: new Set([sale.folio || sale.id]),
              lastOperationAt: saleTime,
              operationTimestamps: new Set([saleTime]),
            });
          } else {
            existing.operationIds.add(sale.folio || sale.id);
            existing.operationTimestamps.add(saleTime);
            if (saleTime > existing.lastOperationAt) {
              existing.lastOperationAt = saleTime;
            }
          }
        }
      }

      const affectedProducts: AffectedCommercialProduct[] = Array.from(productMap.entries()).map(
        ([productId, info]) => ({
          productId,
          operationIds: Array.from(info.operationIds),
          lastOperationAt: info.lastOperationAt,
          operationTimestamps: Array.from(info.operationTimestamps).sort(),
        })
      );

      const commercialActivity = computeCommercialActivitySummaryFromSales({
        workdayId,
        intervalStartAt,
        intervalEndAt,
        sales: allSales as unknown as readonly SaleRecord[],
        isInitialWorkdayInterval,
      });

      // El módulo de despacho y confirmación de ventas ya está operativo e integrado
      const isSalesConfirmationModuleOperational = true;

      const dependencyNotice =
        affectedProducts.length > 0
          ? `Selección automática completada a partir de despachos comerciales confirmados en el intervalo (${affectedProducts.length} producto(s) único(s) afectado(s)). No se permite añadir ni eliminar productos manualmente.`
          : 'El sistema consultó automáticamente los despachos confirmados en el intervalo. No se registraron productos despachados en este intervalo; por regla de control interno no se permite seleccionar productos manualmente ni sustituir ventas con entradas o correcciones.';

      return {
        workdayId,
        intervalStartAt,
        intervalEndAt,
        isSalesConfirmationModuleOperational,
        affectedProducts,
        dependencyNotice,
        commercialActivity,
      };
    });
  }
}

