import React from 'react';
import {
  AlertTriangle,
  Calendar,
  Info,
  PackageCheck,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Card } from '../../../../shared/components/Card';
import { formatDateTime } from '../../../../shared/utils/date';
import { formatCurrency } from '../../../../shared/utils/money';
import {
  PartialCutCommercialActivitySummary,
  PartialCutSummaryMetrics,
} from '../../domain/entities/InventoryCutRecord';

export interface PartialCutCommercialAndBalanceSummaryProps {
  readonly commercialActivity: PartialCutCommercialActivitySummary;
  readonly summary: PartialCutSummaryMetrics;
  readonly countedProductsCount?: number;
  readonly canViewCosts: boolean;
  readonly canViewInventoryBalances?: boolean;
  readonly compact?: boolean;
}

export function PartialCutCommercialAndBalanceSummary({
  commercialActivity,
  summary,
  countedProductsCount,
  canViewCosts,
  canViewInventoryBalances = true,
  compact = false,
}: PartialCutCommercialAndBalanceSummaryProps) {
  const effectiveCountedProducts = countedProductsCount ?? summary.totalProductsAudited;

  return (
    <div className="space-y-5">
      {/* ===================================================================== */}
      {/* APARTADO A: ACTIVIDAD COMERCIAL DEL PERÍODO                           */}
      {/* ===================================================================== */}
      <Card className="border-t-4 border-t-[#1A5F7A]">
        <div className={compact ? 'p-4 space-y-4' : 'p-5 space-y-4'}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1A5F7A]/10 text-[#1A5F7A] border border-[#1A5F7A]/20">
                <Receipt className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold tracking-wide text-[#123F55] uppercase">
                  ACTIVIDAD COMERCIAL DEL PERÍODO
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mercancía efectivamente despachada durante el intervalo del corte parcial (precios históricos congelados al despachar).
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              <Calendar className="h-3.5 w-3.5 text-[#1A5F7A] shrink-0" />
              <span>
                Intervalo: <strong>{formatDateTime(commercialActivity.intervalStartAt)}</strong> →{' '}
                <strong>{formatDateTime(commercialActivity.intervalEndAt)}</strong>
              </span>
            </div>
          </div>

          {/* Aviso aclaratorio obligatorio del apartado comercial */}
          <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3.5 py-2.5 text-xs text-sky-950">
            <Info className="h-4 w-4 text-sky-700 shrink-0 mt-0.5" />
            <p className="font-medium leading-relaxed">
              Estos importes representan el valor de la mercancía despachada durante el período. No corresponden necesariamente a dinero cobrado.
            </p>
          </div>

          {/* Aviso si existen datos históricos incompletos en cortes antiguos */}
          {commercialActivity.hasInsufficientHistoricalData &&
            commercialActivity.historicalDataNotice && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950">
                <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{commercialActivity.historicalDataNotice}</p>
              </div>
            )}

          {/* Indicadores principales de Actividad Comercial */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <span className="text-[11px] font-medium text-slate-500 block">
                1. Despachos realizados
              </span>
              <strong className="mt-1 block text-base font-bold text-slate-900 font-mono tabular-nums">
                {commercialActivity.totalDispatchesCount}
              </strong>
              <span className="mt-0.5 block text-[11px] text-slate-500 truncate">
                {commercialActivity.dispatchFolios.length > 0
                  ? `Folios: ${commercialActivity.dispatchFolios.join(', ')}`
                  : 'Sin despachos en el período'}
              </span>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <span className="text-[11px] font-medium text-slate-500 block">
                2. Productos distintos despachados
              </span>
              <strong className="mt-1 block text-base font-bold text-slate-900 font-mono tabular-nums">
                {commercialActivity.distinctProductsCount}
              </strong>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Consolidados sin duplicar partidas
              </span>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <span className="text-[11px] font-medium text-slate-500 block">
                3. Cantidad total despachada
              </span>
              {commercialActivity.distinctProductsCount === 0 ? (
                <>
                  <strong className="mt-1 block text-base font-bold text-slate-900 font-mono tabular-nums">
                    0
                  </strong>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    Sin unidades despachadas
                  </span>
                </>
              ) : commercialActivity.areUnitsComparable &&
                commercialActivity.comparableTotalQuantity !== null ? (
                <>
                  <strong className="mt-1 block text-base font-bold text-slate-900 font-mono tabular-nums">
                    {commercialActivity.comparableTotalQuantity}{' '}
                    {commercialActivity.comparableUnitSymbol ||
                      commercialActivity.comparableUnitName ||
                      ''}
                  </strong>
                  <span className="mt-0.5 block text-[11px] text-emerald-700 font-medium">
                    Unidades comparables ({commercialActivity.comparableUnitName})
                  </span>
                </>
              ) : (
                <>
                  <strong className="mt-1 block text-xs font-bold text-amber-800">
                    Unidades incompatibles (ver desglose)
                  </strong>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    No se suman unidades de distinta naturaleza
                  </span>
                </>
              )}
            </div>

            <div className="rounded-lg bg-[#1A5F7A]/5 border border-[#1A5F7A]/25 p-3">
              <span className="text-[11px] font-semibold text-[#123F55] block">
                4. Valor comercial despachado
              </span>
              <strong className="mt-1 block text-base font-bold text-[#123F55] font-mono tabular-nums">
                {formatCurrency(commercialActivity.totalCommercialValue)}
              </strong>
              <span className="mt-0.5 block text-[11px] text-slate-600">
                Calculado a precio histórico de cada despacho
              </span>
            </div>
          </div>

          {/* Fechas exactas del intervalo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-slate-50/80 border border-slate-200 px-3 py-2 flex items-center justify-between">
              <span className="text-slate-500">5. Fecha y hora de inicio del intervalo:</span>
              <strong className="font-mono text-slate-800">
                {formatDateTime(commercialActivity.intervalStartAt)}
              </strong>
            </div>
            <div className="rounded-lg bg-slate-50/80 border border-slate-200 px-3 py-2 flex items-center justify-between">
              <span className="text-slate-500">
                6. Fecha y hora de finalización del intervalo:
              </span>
              <strong className="font-mono text-slate-800">
                {formatDateTime(commercialActivity.intervalEndAt)}
              </strong>
            </div>
          </div>

          {/* Desglose por producto despachado */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Desglose por producto despachado ({commercialActivity.productBreakdown.length})
              </h4>
              <span className="text-[11px] text-slate-500">
                Importes consolidados por despacho real en el intervalo
              </span>
            </div>

            {commercialActivity.productBreakdown.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-5 text-center text-xs text-slate-500">
                <PackageCheck className="mx-auto h-5 w-5 text-slate-400 mb-1.5" />
                <p className="font-semibold text-slate-700">
                  Sin mercancía despachada durante este intervalo
                </p>
                <p className="mt-0.5 text-[11px]">
                  No se registraron despachos directos ni de cuentas abiertas dentro del período del corte (Valor comercial: $0.00).
                </p>
              </div>
            ) : (
              <div className="max-h-[45dvh] overflow-x-auto overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-100 shadow-[0_1px_0_0_#cbd5e1]">
                    <tr className="border-b border-slate-200 text-slate-700 font-semibold">
                      <th className="py-2.5 px-3 bg-slate-100 whitespace-nowrap">Código / SKU</th>
                      <th className="py-2.5 px-3 bg-slate-100">Nombre del producto</th>
                      <th className="py-2.5 px-3 bg-slate-100 whitespace-nowrap">
                        Unidad de medida
                      </th>
                      <th className="py-2.5 px-3 text-right bg-slate-100 whitespace-nowrap">
                        Cantidad despachada
                      </th>
                      <th className="py-2.5 px-3 text-right bg-slate-100 whitespace-nowrap">
                        N.º de despachos
                      </th>
                      <th className="py-2.5 px-3 text-right bg-slate-100 whitespace-nowrap">
                        Precio(s) histórico(s)
                      </th>
                      <th className="py-2.5 px-3 text-right bg-slate-100 whitespace-nowrap">
                        Valor comercial total despachado
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {commercialActivity.productBreakdown.map((item) => (
                      <tr key={item.productId} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                          <div className="font-semibold">{item.productCode}</div>
                          {item.sku && item.sku !== item.productCode && (
                            <div className="text-[10px] text-slate-500">SKU: {item.sku}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {item.productName}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                          {item.unitName} ({item.unitSymbol})
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                          {item.dispatchedQuantity} {item.unitSymbol}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                          <span className="font-semibold">{item.dispatchCount}</span>
                          {item.dispatchFolios.length > 0 && (
                            <div className="text-[10px] text-slate-400">
                              {item.dispatchFolios.join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {item.distinctHistoricalUnitPrices.length === 0 ? (
                            '—'
                          ) : item.distinctHistoricalUnitPrices.length === 1 ? (
                            formatCurrency(item.distinctHistoricalUnitPrices[0])
                          ) : (
                            <div className="space-y-0.5">
                              <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded block">
                                Varios precios históricos
                              </span>
                              <span className="text-[10px] text-slate-600 block">
                                {item.distinctHistoricalUnitPrices
                                  .map((p) => formatCurrency(p))
                                  .join(' / ')}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#123F55] tabular-nums whitespace-nowrap">
                          {formatCurrency(item.totalCommercialAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-900">
                    <tr>
                      <td colSpan={6} className="py-2.5 px-3 text-right text-xs">
                        Valor comercial total de mercancía despachada en el período:
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-[#123F55] tabular-nums whitespace-nowrap">
                        {formatCurrency(commercialActivity.totalCommercialValue)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ===================================================================== */}
      {/* APARTADO B: CONCILIACIÓN Y BALANCE DE INVENTARIO                      */}
      {/* ===================================================================== */}
      {canViewInventoryBalances && (
        <Card className="border-t-4 border-t-slate-700">
          <div className={compact ? 'p-4 space-y-4' : 'p-5 space-y-4'}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-800 border border-slate-300">
                  <Scale className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-wide text-slate-900 uppercase">
                    CONCILIACIÓN Y BALANCE DE INVENTARIO (BALANCE ECONÓMICO DEL INVENTARIO)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Resultado físico del conteo frente a la existencia teórica conciliada. Independiente de la actividad comercial.
                  </p>
                </div>
              </div>
            </div>

            {/* Aviso aclaratorio obligatorio del apartado de balance de inventario */}
            <div className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800">
              <Info className="h-4 w-4 text-slate-700 shrink-0 mt-0.5" />
              <p className="font-medium leading-relaxed">
                El balance de inventario refleja exclusivamente el valor de las diferencias físicas encontradas. No representa las ventas del período.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Tarjeta 1: Clasificación de productos contados */}
              <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#123F55] uppercase tracking-wider">
                    Productos Contados
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    Contados: {effectiveCountedProducts}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5">
                    <span className="text-[11px] text-emerald-700 block">Sin diferencia</span>
                    <strong className="text-base font-bold text-emerald-800 font-mono tabular-nums">
                      {summary.productsWithoutDifference}
                    </strong>
                  </div>
                  <div className="rounded-lg bg-red-50 border border-red-200 p-2.5">
                    <span className="text-[11px] text-red-700 block">Con faltante</span>
                    <strong className="text-base font-bold text-red-800 font-mono tabular-nums">
                      {summary.productsWithShortage}
                    </strong>
                  </div>
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-2.5">
                    <span className="text-[11px] text-blue-700 block">Con sobrante</span>
                    <strong className="text-base font-bold text-blue-800 font-mono tabular-nums">
                      {summary.productsWithSurplus}
                    </strong>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-snug">
                  No se suman cantidades físicas de productos con unidades de medida incompatibles.
                </p>
              </div>

              {/* Tarjeta 2: Valoración de Faltantes y Sobrantes */}
              <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-2.5 text-xs">
                <span className="text-xs font-bold text-[#123F55] uppercase tracking-wider block">
                  Valor de Faltantes y Sobrantes
                </span>
                <div className="rounded-lg bg-red-50/70 border border-red-200 p-2.5 space-y-1">
                  <div className="font-semibold text-red-800 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1">
                      <TrendingDown className="h-3.5 w-3.5" />
                      Faltantes físicos
                    </span>
                    <span>{summary.productsWithShortage} prod.</span>
                  </div>
                  {canViewCosts && (
                    <div className="flex justify-between text-red-700">
                      <span>Valor de faltantes a costo de compra:</span>
                      <strong className="font-mono tabular-nums">
                        {summary.totalShortagePurchaseValue > 0 ? '-' : ''}
                        {formatCurrency(summary.totalShortagePurchaseValue)}
                      </strong>
                    </div>
                  )}
                  <div className="flex justify-between text-red-800">
                    <span>Valor de faltantes a precio de venta:</span>
                    <strong className="font-mono tabular-nums">
                      {summary.totalShortageSaleValue > 0 ? '-' : ''}
                      {formatCurrency(summary.totalShortageSaleValue)}
                    </strong>
                  </div>
                </div>

                <div className="rounded-lg bg-blue-50/70 border border-blue-200 p-2.5 space-y-1">
                  <div className="font-semibold text-blue-800 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Sobrantes físicos
                    </span>
                    <span>{summary.productsWithSurplus} prod.</span>
                  </div>
                  {canViewCosts && (
                    <div className="flex justify-between text-blue-700">
                      <span>Valor de sobrantes a costo de compra:</span>
                      <strong className="font-mono tabular-nums">
                        {summary.totalSurplusPurchaseValue > 0 ? '+' : ''}
                        {formatCurrency(summary.totalSurplusPurchaseValue)}
                      </strong>
                    </div>
                  )}
                  <div className="flex justify-between text-blue-800">
                    <span>Valor de sobrantes a precio de venta:</span>
                    <strong className="font-mono tabular-nums">
                      {summary.totalSurplusSaleValue > 0 ? '+' : ''}
                      {formatCurrency(summary.totalSurplusSaleValue)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Tarjeta 3: Balance Económico Neto del Inventario */}
              <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3 text-xs flex flex-col justify-between">
                <div className="space-y-2.5">
                  <span className="text-xs font-bold text-[#123F55] uppercase tracking-wider block">
                    Balance Económico del Inventario
                  </span>
                  {canViewCosts && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-center justify-between">
                      <div>
                        <span className="text-slate-700 font-semibold block">
                          Balance neto a costo de compra
                        </span>
                        <span className="text-[10px] text-slate-500">
                          Sobrantes compra − Faltantes compra
                        </span>
                      </div>
                      <strong
                        className={[
                          'text-sm font-mono font-bold tabular-nums',
                          summary.netPurchaseBalance < 0
                            ? 'text-red-700'
                            : summary.netPurchaseBalance > 0
                              ? 'text-blue-700'
                              : 'text-emerald-700',
                        ].join(' ')}
                      >
                        {summary.netPurchaseBalance > 0 ? '+' : ''}
                        {formatCurrency(summary.netPurchaseBalance)}
                      </strong>
                    </div>
                  )}

                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-center justify-between">
                    <div>
                      <span className="text-slate-700 font-semibold block">
                        Balance neto a precio de venta
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Sobrantes venta − Faltantes venta
                      </span>
                    </div>
                    <strong
                      className={[
                        'text-sm font-mono font-bold tabular-nums',
                        summary.netSaleBalance < 0
                          ? 'text-red-700'
                          : summary.netSaleBalance > 0
                            ? 'text-blue-700'
                            : 'text-emerald-700',
                      ].join(' ')}
                    >
                      {summary.netSaleBalance > 0 ? '+' : ''}
                      {formatCurrency(summary.netSaleBalance)}
                    </strong>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 italic">
                  Si el conteo físico coincide con la existencia teórica, el balance económico del inventario es $0.00 con independencia del valor comercial despachado.
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
