import { EntityId } from '../../../../shared/types/entity';
import { SaleRecord, SaleStatus } from '../../../sales/domain/entities/SaleRecord';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundQuantity(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface ProductCommercialPerformanceItem {
  readonly productId: EntityId;
  readonly productName: string;
  readonly productCode: string;
  readonly unitSymbol: string;
  readonly dispatchedQuantity: number;
  readonly dispatchesCount: number;
  readonly commercialValue: number;
  readonly costAmount: number;
  readonly hasUnknownCost: boolean;
  readonly grossProfit: number; // Utilidad Bruta (Valor Comercial - Costo Atribuido)
  readonly grossGain: number;   // Ganancia Bruta (Valor Comercial - Costo Atribuido)
  readonly marginPercentage: number;
}

export interface WorkdayCommercialPerformanceResult {
  readonly totalDispatchesCount: number;
  readonly distinctProductsCount: number;
  readonly totalDispatchedUnits: number;
  readonly totalCommercialValue: number;
  readonly totalCostOfGoodsDispatched: number;
  readonly hasUnknownCosts: boolean;
  readonly grossProfit: number; // Utilidad Bruta
  readonly grossGain: number;   // Ganancia Bruta
  readonly grossMarginPercentage: number;
  readonly productBreakdown: readonly ProductCommercialPerformanceItem[];
}

export type CommercialPerformanceResult = WorkdayCommercialPerformanceResult;

/**
 * Servicio de dominio centralizado para el cálculo riguroso de rendimiento comercial,
 * Ganancia Bruta y Utilidad Bruta sobre ventas efectivamente despachadas.
 * 
 * Recuperación histórica de costos:
 * 1. Atribución FIFO / Costo explícito congelado en la partida o venta (`totalCostAmount`, `costAttribution`).
 * 2. Precios unitarios de compra registrados en la partida (`unitPurchasePrice`, `lastPurchasePrice`, `costPrice`).
 * 3. Último precio de compra registrado en el catálogo de productos (`product.lastPurchasePrice` / fuente de costos).
 * 
 * Regla inalterable:
 * Ganancia Bruta = Utilidad Bruta = Valor Comercial Despachado − Costo de Compra Atribuido.
 * Solo si el costo no existe en ninguna fuente histórica se marca `hasUnknownCosts = true`.
 */
export function calculateCommercialPerformance(
  sales: readonly SaleRecord[],
  productCostSource?: Map<string, number> | Record<string, number> | readonly any[]
): CommercialPerformanceResult {
  const dispatchedSales = sales.filter(
    (s) =>
      s.status === SaleStatus.DISPATCHED ||
      (s.status as string) === 'COMPLETED'
  );

  // Construir mapa de costos de referencia si se proporcionó una fuente de productos
  const costLookupMap = new Map<string, number>();
  if (productCostSource) {
    if (productCostSource instanceof Map) {
      productCostSource.forEach((cost, id) => {
        if (typeof cost === 'number' && Number.isFinite(cost)) {
          costLookupMap.set(id, cost);
        }
      });
    } else if (Array.isArray(productCostSource)) {
      for (const p of productCostSource) {
        if (p && typeof p.id === 'string') {
          const cost = typeof p.lastPurchasePrice === 'number' ? p.lastPurchasePrice
            : typeof p.purchaseCost === 'number' ? p.purchaseCost
            : typeof p.costPrice === 'number' ? p.costPrice
            : null;
          if (cost !== null && Number.isFinite(cost)) {
            costLookupMap.set(p.id, cost);
          }
        }
      }
    } else if (typeof productCostSource === 'object') {
      Object.entries(productCostSource).forEach(([id, cost]) => {
        if (typeof cost === 'number' && Number.isFinite(cost)) {
          costLookupMap.set(id, cost);
        }
      });
    }
  }

  let totalCommercialValue = 0;
  let totalCostOfGoodsDispatched = 0;
  let hasUnknownCosts = false;

  const productStatsMap = new Map<
    string,
    {
      productName: string;
      productCode: string;
      unitSymbol: string;
      dispatchedQuantity: number;
      dispatchesCount: number;
      commercialValue: number;
      costAmount: number;
      hasUnknownCost: boolean;
    }
  >();

  for (const sale of dispatchedSales) {
    const saleCommercialValue = sale.totalAmount || 0;
    totalCommercialValue = roundMoney(totalCommercialValue + saleCommercialValue);

    let saleHasCostInfo = false;
    let saleCostTotal = 0;

    if (typeof sale.totalCostAmount === 'number' && Number.isFinite(sale.totalCostAmount)) {
      saleHasCostInfo = true;
      saleCostTotal = sale.totalCostAmount;
    }

    for (const line of sale.items || []) {
      const lineSubtotal = line.lineSubtotal ?? roundMoney(line.quantity * line.unitSalePrice);
      
      let lineCost: number | null = null;
      let lineHasUnknown = false;

      // Prioridad 1: Costo total directo en la línea
      if (typeof (line as any).totalCostAmount === 'number' && Number.isFinite((line as any).totalCostAmount)) {
        lineCost = (line as any).totalCostAmount;
      }
      // Prioridad 2: Proporción sobre el total de costo de la venta
      else if (saleHasCostInfo && saleCommercialValue > 0) {
        lineCost = roundMoney(saleCostTotal * (lineSubtotal / saleCommercialValue));
      }
      // Prioridad 3: Atribución FIFO detallada en la línea
      else if (typeof (line as any).costAttribution === 'object' && Array.isArray((line as any).costAttribution) && (line as any).costAttribution.length > 0) {
        const attrCost = (line as any).costAttribution.reduce(
          (sum: number, c: any) => sum + (c.allocatedCost ?? 0),
          0
        );
        lineCost = roundMoney(attrCost);
      }
      // Prioridad 4: Precios de costo unitario registrados en la línea
      else if (typeof (line as any).unitPurchasePrice === 'number' && Number.isFinite((line as any).unitPurchasePrice)) {
        lineCost = roundMoney(line.quantity * (line as any).unitPurchasePrice);
      }
      else if (typeof (line as any).lastPurchasePrice === 'number' && Number.isFinite((line as any).lastPurchasePrice)) {
        lineCost = roundMoney(line.quantity * (line as any).lastPurchasePrice);
      }
      else if (typeof (line as any).costPrice === 'number' && Number.isFinite((line as any).costPrice)) {
        lineCost = roundMoney(line.quantity * (line as any).costPrice);
      }
      // Prioridad 5: Precio de compra recuperado del catálogo / mapa de productos
      else if (costLookupMap.has(line.productId)) {
        const catalogCost = costLookupMap.get(line.productId)!;
        lineCost = roundMoney(line.quantity * catalogCost);
      }
      // Si no se encuentra costo en ninguna fuente
      else {
        lineHasUnknown = true;
        hasUnknownCosts = true;
      }

      const effectiveLineCost = lineCost ?? 0;
      if (!lineHasUnknown) {
        totalCostOfGoodsDispatched = roundMoney(totalCostOfGoodsDispatched + effectiveLineCost);
      }

      const existing = productStatsMap.get(line.productId) || {
        productName: line.productName,
        productCode: line.productCode || line.sku || 'PRD',
        unitSymbol: line.unitSymbol || 'u.',
        dispatchedQuantity: 0,
        dispatchesCount: 0,
        commercialValue: 0,
        costAmount: 0,
        hasUnknownCost: false,
      };

      productStatsMap.set(line.productId, {
        ...existing,
        dispatchedQuantity: roundQuantity(existing.dispatchedQuantity + line.quantity),
        dispatchesCount: existing.dispatchesCount + 1,
        commercialValue: roundMoney(existing.commercialValue + lineSubtotal),
        costAmount: roundMoney(existing.costAmount + effectiveLineCost),
        hasUnknownCost: existing.hasUnknownCost || lineHasUnknown,
      });
    }
  }

  const grossProfit = roundMoney(totalCommercialValue - totalCostOfGoodsDispatched);
  const grossGain = grossProfit;
  const grossMarginPercentage =
    totalCommercialValue > 0 ? roundMoney((grossProfit / totalCommercialValue) * 100) : 0;

  let totalDispatchedUnits = 0;

  const productBreakdown: ProductCommercialPerformanceItem[] = Array.from(
    productStatsMap.entries()
  ).map(([productId, stat]) => {
    totalDispatchedUnits = roundQuantity(totalDispatchedUnits + stat.dispatchedQuantity);
    const pProfit = roundMoney(stat.commercialValue - stat.costAmount);
    const pMargin = stat.commercialValue > 0 ? roundMoney((pProfit / stat.commercialValue) * 100) : 0;
    return {
      productId,
      productName: stat.productName,
      productCode: stat.productCode,
      unitSymbol: stat.unitSymbol,
      dispatchedQuantity: stat.dispatchedQuantity,
      dispatchesCount: stat.dispatchesCount,
      commercialValue: stat.commercialValue,
      costAmount: stat.costAmount,
      hasUnknownCost: stat.hasUnknownCost,
      grossProfit: pProfit,
      grossGain: pProfit,
      marginPercentage: pMargin,
    };
  });

  return {
    totalDispatchesCount: dispatchedSales.length,
    distinctProductsCount: productStatsMap.size,
    totalDispatchedUnits,
    totalCommercialValue,
    totalCostOfGoodsDispatched,
    hasUnknownCosts,
    grossProfit,
    grossGain,
    grossMarginPercentage,
    productBreakdown,
  };
}

export function calculateWorkdayCommercialPerformance(
  workdayId: string,
  allSales: readonly SaleRecord[],
  productCostSource?: Map<string, number> | Record<string, number> | readonly any[]
): WorkdayCommercialPerformanceResult {
  const workdaySales = allSales.filter(
    (s) =>
      (s.status === SaleStatus.DISPATCHED || (s.status as string) === 'COMPLETED') &&
      (s.dispatchedWorkdayId === workdayId || s.createdWorkdayId === workdayId || s.workdayId === workdayId)
  );

  return calculateCommercialPerformance(workdaySales, productCostSource);
}
