import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Filter,
  FileSpreadsheet,
  History,
  Layers,
  Package,
  PackagePlus,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  Tag,
  TrendingUp,
  X,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { useRouter } from '../../../../app/router/RouterProvider';
import { ROUTES } from '../../../../app/router/routes';
import { Button } from '../../../../shared/components/Button';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime } from '../../../../shared/utils/date';
import { formatCurrency } from '../../../../shared/utils/money';
import {
  HistoryOperationFilter,
  KardexMovementEntry,
  PriceChangeRecord,
  ProductAvailability,
  ProductHistoryEventType,
  ProductStatus,
  ProductStatusChangeRecord,
  UnifiedHistoryEvent,
} from '../../domain/entities/ProductHistoryRecords';
import { MerchandiseEntryRecord } from '../../domain/entities/MerchandiseEntryRecord';
import {
  exportKardexCsv,
  exportMerchandiseEntriesCsv,
  exportPriceChangesCsv,
  exportStatusChangesCsv,
  exportUnifiedActivityCsv,
} from '../utils/exportProductHistoryCsv';

export interface ProductHistoryPageProps {
  readonly productId: string;
}

type ActiveTab = 'ACTIVITY' | 'ENTRIES' | 'KARDEX' | 'PRICES' | 'STATUSES';

const ITEMS_PER_PAGE = 25;

export function ProductHistoryPage({ productId }: ProductHistoryPageProps) {
  const { useCases, dataRevision } = useApplication();
  const { actor, can } = useSession();
  const { navigate } = useRouter();

  const canViewCosts = can(Permission.VIEW_PRODUCT_COSTS);
  const canManageProducts = can(Permission.MANAGE_PRODUCTS);

  const [activeTab, setActiveTab] = useState<ActiveTab>('ACTIVITY');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);

  // Filtros
  const [operationType, setOperationType] = useState<HistoryOperationFilter>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [dateFilterError, setDateFilterError] = useState<string | null>(null);

  // Consulta del historial del producto mediante el caso de uso
  const {
    data: historyData,
    isLoading,
    error,
    reload,
  } = useAsyncQuery(
    async () => {
      if (startDate && endDate && startDate > endDate) {
        setDateFilterError('La fecha inicial no puede ser posterior a la fecha final.');
        return null;
      }
      setDateFilterError(null);

      return useCases.warehouse.getProductHistory.execute(actor, {
        productId,
        filters: {
          operationType,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        },
      });
    },
    [useCases.warehouse.getProductHistory, actor, productId, operationType, startDate, endDate, dataRevision]
  );

  const summary = historyData?.summary;

  const handleClearFilters = () => {
    setOperationType('ALL');
    setStartDate('');
    setEndDate('');
    setDateFilterError(null);
    setCurrentPage(1);
  };

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  // Obtener la colección activa para la pestaña actual
  const currentTabItems = useMemo(() => {
    if (!historyData) return [];
    switch (activeTab) {
      case 'ACTIVITY':
        return historyData.unifiedEvents;
      case 'ENTRIES':
        return historyData.merchandiseEntries;
      case 'KARDEX':
        return historyData.kardexMovements;
      case 'PRICES':
        return historyData.priceChanges;
      case 'STATUSES':
        return historyData.statusChanges;
      default:
        return [];
    }
  }, [historyData, activeTab]);

  // Paginación a 25 registros
  const totalItems = currentTabItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const paginatedItems = useMemo(() => {
    return currentTabItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [currentTabItems, startIndex]);

  if (isLoading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-[#123F55]" />
        <p className="text-xs font-medium text-slate-500">Cargando historial y trazabilidad del producto...</p>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate(ROUTES.warehouseProducts)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver al catálogo de productos</span>
        </button>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-semibold text-red-800">
            {error ?? 'No se pudo cargar el historial del producto solicitado.'}
          </p>
          <p className="mt-1 text-xs text-red-600">
            Verifique que el producto existe en el almacén o que su rol dispone de permisos de consulta.
          </p>
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={() => reload()}>
              Reintentar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Barra superior de navegación y retorno */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(ROUTES.warehouseProducts)}
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#123F55] hover:text-[#0D2D3E] hover:underline cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver a Productos</span>
        </button>

        {/* Menú de exportación CSV (solo si tiene permisos) */}
        {canManageProducts && (
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={() => setIsExportMenuOpen((prev) => !prev)}
            >
              Exportar CSV
            </Button>

            {isExportMenuOpen && (
              <div
                className="absolute right-0 z-30 mt-1 w-64 origin-top-right rounded-lg bg-white shadow-lg ring-1 ring-black/10 focus:outline-none divide-y divide-slate-100 py-1"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Descargar reporte en CSV
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    exportUnifiedActivityCsv(summary, historyData.unifiedEvents, canViewCosts);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer text-left"
                >
                  <FileSpreadsheet className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="font-medium text-slate-800">Actividad general</div>
                    <div className="text-[10px] text-slate-500">
                      {historyData.unifiedEvents.length} eventos cronológicos
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    exportKardexCsv(summary, historyData.kardexMovements);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer text-left"
                >
                  <Layers className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="font-medium text-slate-800">Kardex de movimientos</div>
                    <div className="text-[10px] text-slate-500">
                      {historyData.kardexMovements.length} variaciones físicas
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    exportMerchandiseEntriesCsv(summary, historyData.merchandiseEntries, canViewCosts);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer text-left"
                >
                  <PackagePlus className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="font-medium text-slate-800">Entradas de mercancía</div>
                    <div className="text-[10px] text-slate-500">
                      {historyData.merchandiseEntries.length} recepciones
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    exportPriceChangesCsv(summary, historyData.priceChanges);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer text-left"
                >
                  <Tag className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="font-medium text-slate-800">Historial de precios</div>
                    <div className="text-[10px] text-slate-500">
                      {historyData.priceChanges.length} modificaciones
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    exportStatusChangesCsv(summary, historyData.statusChanges);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer text-left"
                >
                  <Power className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="font-medium text-slate-800">Historial de estados</div>
                    <div className="text-[10px] text-slate-500">
                      {historyData.statusChanges.length} activaciones/desactivaciones
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* FICHA IDENTIFICATIVA DEL PRODUCTO */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{summary.name}</h1>
              {/* Badges de estado administrativo y disponibilidad */}
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
                  summary.status === ProductStatus.ACTIVE
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-300'
                }`}
              >
                {summary.status === ProductStatus.ACTIVE ? (
                  <>
                    <Power className="w-3 h-3 text-emerald-600" />
                    <span>Activo</span>
                  </>
                ) : (
                  <>
                    <PowerOff className="w-3 h-3 text-slate-500" />
                    <span>Inactivo</span>
                  </>
                )}
              </span>

              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                  summary.availability === ProductAvailability.AVAILABLE
                    ? 'bg-blue-50 text-blue-800 border border-blue-200'
                    : summary.availability === ProductAvailability.OUT_OF_STOCK
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-slate-100 text-slate-500 border border-slate-200'
                }`}
              >
                {summary.availability === ProductAvailability.AVAILABLE
                  ? 'Disponible'
                  : summary.availability === ProductAvailability.OUT_OF_STOCK
                  ? 'Agotado'
                  : 'Inactivo'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="font-mono text-slate-700">{summary.code}</span>
              {summary.sku && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>SKU: <strong className="font-mono text-slate-700">{summary.sku}</strong></span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>Categoría: <strong className="text-slate-700">{summary.categoryLabel}</strong></span>
              <span aria-hidden="true">·</span>
              <span>Unidad: <strong className="text-slate-700">{summary.unitLabel}</strong></span>
              <span aria-hidden="true">·</span>
              <span>Alta: {formatDateTime(summary.createdAt)}</span>
            </div>
          </div>

          {/* Métricas clave del producto */}
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:gap-4 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100">
            <div className="rounded-lg bg-slate-50 p-2.5 sm:text-right border border-slate-100">
              <div className="text-[11px] font-medium text-slate-500">Existencia actual</div>
              <div className="text-lg font-bold text-slate-900">
                {summary.currentStock}{' '}
                <span className="text-xs font-normal text-slate-500">{summary.unitSymbol}</span>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-2.5 sm:text-right border border-slate-100">
              <div className="text-[11px] font-medium text-slate-500">Precio venta vigente</div>
              <div className="text-lg font-bold text-[#123F55]">
                {formatCurrency(summary.currentSalePrice)}
              </div>
            </div>

            {canViewCosts && summary.lastPurchasePrice !== undefined && (
              <div className="rounded-lg bg-slate-50 p-2.5 sm:text-right border border-slate-100">
                <div className="text-[11px] font-medium text-slate-500">Último costo compra</div>
                <div className="text-lg font-bold text-slate-700">
                  {formatCurrency(summary.lastPurchasePrice)}
                </div>
              </div>
            )}

            {canViewCosts && summary.marginPercentage !== undefined && (
              <div className="rounded-lg bg-slate-50 p-2.5 sm:text-right border border-slate-100">
                <div className="text-[11px] font-medium text-slate-500">Margen actual</div>
                <div className="text-lg font-bold text-emerald-700">
                  {summary.marginPercentage > 0 ? `+${summary.marginPercentage}%` : `${summary.marginPercentage}%`}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BARRA DE FILTROS Y BÚSQUEDAS */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mr-1">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Filtros:</span>
            </div>

            {/* Selector de tipo de operación */}
            <select
              value={operationType}
              onChange={(e) => {
                setOperationType(e.target.value as HistoryOperationFilter);
                setCurrentPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-[#123F55] focus:outline-none"
            >
              <option value="ALL">Todas las operaciones</option>
              <option value="ENTRIES">Entradas de mercancía</option>
              <option value="SALES">Salidas por despacho</option>
              <option value="CORRECTIONS">Correcciones de inventario</option>
              <option value="PARTIAL_CUTS">Ajustes por corte parcial</option>
              <option value="PRICES">Cambios de precio</option>
              <option value="STATUSES">Cambios de estado</option>
            </select>

            {/* Rango de fechas */}
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-[#123F55] focus:outline-none"
                placeholder="Desde"
              />
              <span className="text-xs text-slate-400">a</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-[#123F55] focus:outline-none"
                placeholder="Hasta"
              />
            </div>

            {(operationType !== 'ALL' || startDate || endDate) && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Limpiar</span>
              </button>
            )}
          </div>

          <div className="text-xs text-slate-500 self-end md:self-auto">
            Total filtrado: <strong>{totalItems}</strong> registros
          </div>
        </div>

        {dateFilterError && (
          <div className="text-xs font-medium text-red-600 bg-red-50 p-2 rounded border border-red-200">
            {dateFilterError}
          </div>
        )}
      </div>

      {/* CONTROL DE PESTAÑAS (SEGMENTED CONTROL) */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-2 sm:space-x-4 overflow-x-auto" aria-label="Secciones del historial">
          <button
            type="button"
            onClick={() => handleTabChange('ACTIVITY')}
            className={`whitespace-nowrap pb-3 px-1 text-xs sm:text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'ACTIVITY'
                ? 'border-[#123F55] text-[#123F55]'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Actividad general ({historyData.unifiedEvents.length})
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('KARDEX')}
            className={`whitespace-nowrap pb-3 px-1 text-xs sm:text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'KARDEX'
                ? 'border-[#123F55] text-[#123F55]'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Movimientos / Kardex ({historyData.kardexMovements.length})
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('ENTRIES')}
            className={`whitespace-nowrap pb-3 px-1 text-xs sm:text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'ENTRIES'
                ? 'border-[#123F55] text-[#123F55]'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Entradas de mercancía ({historyData.merchandiseEntries.length})
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('PRICES')}
            className={`whitespace-nowrap pb-3 px-1 text-xs sm:text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'PRICES'
                ? 'border-[#123F55] text-[#123F55]'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Precios ({historyData.priceChanges.length})
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('STATUSES')}
            className={`whitespace-nowrap pb-3 px-1 text-xs sm:text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'STATUSES'
                ? 'border-[#123F55] text-[#123F55]'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Estados ({historyData.statusChanges.length})
          </button>
        </nav>
      </div>

      {/* CONTENIDO DE LA PESTAÑA SELECCIONADA */}
      <div className="space-y-4">
        {totalItems === 0 ? (
          <EmptyState
            title="Sin registros en este período"
            description="No se encontraron eventos u operaciones para los filtros seleccionados."
            action={
              <Button size="sm" variant="secondary" onClick={handleClearFilters}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <>
            {/* PESTAÑA 1: ACTIVIDAD GENERAL (TIMELINE) */}
            {activeTab === 'ACTIVITY' && (
              <div className="space-y-3">
                {(paginatedItems as UnifiedHistoryEvent[]).map((ev) => {
                  return (
                    <div
                      key={ev.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-slate-300 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 shrink-0 rounded-lg p-2 bg-slate-50 border border-slate-200">
                            {ev.eventType === ProductHistoryEventType.INITIAL_REGISTRATION && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            )}
                            {ev.eventType === ProductHistoryEventType.MERCHANDISE_ENTRY && (
                              <PackagePlus className="w-4 h-4 text-[#123F55]" />
                            )}
                            {ev.eventType === ProductHistoryEventType.STOCK_CORRECTION &&
                              (ev.correctionType === 'POSITIVE' ? (
                                <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <ArrowDownRight className="w-4 h-4 text-rose-600" />
                              ))}
                            {ev.eventType === ProductHistoryEventType.SALE_DISPATCH && (
                              <ArrowDownRight className="w-4 h-4 text-[#1A5F7A]" />
                            )}
                            {ev.eventType === ProductHistoryEventType.PARTIAL_CUT_ADJUSTMENT && (
                              <Scissors className="w-4 h-4 text-indigo-600" />
                            )}
                            {ev.eventType === ProductHistoryEventType.PRICE_CHANGE && (
                              <Tag className="w-4 h-4 text-amber-600" />
                            )}
                            {ev.eventType === ProductHistoryEventType.STATUS_CHANGE &&
                              (ev.newStatus === ProductStatus.ACTIVE ? (
                                <Power className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <PowerOff className="w-4 h-4 text-slate-500" />
                              ))}
                          </div>

                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-900">{ev.title}</h3>
                              {ev.partialCutFolio && (
                                <span className="font-mono text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                                  {ev.partialCutFolio}
                                </span>
                              )}
                              {ev.workdayFolio && (
                                <span className="font-mono text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                                  {ev.workdayFolio}
                                </span>
                              )}
                              <span className="text-[11px] font-mono text-slate-400">
                                {formatDateTime(ev.timestamp)}
                              </span>
                            </div>

                            <p className="text-xs text-slate-600 leading-relaxed">{ev.description}</p>

                            {/* Detalles complementarios según tipo */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-slate-500">
                              {ev.declaredDate && (
                                <span>
                                  Fecha declarada: <strong>{ev.declaredDate}</strong>
                                </span>
                              )}

                              {canViewCosts && ev.unitPurchasePrice !== undefined && (
                                <span>
                                  Costo unitario: <strong>{formatCurrency(ev.unitPurchasePrice)}</strong>
                                </span>
                              )}

                              {canViewCosts && ev.totalCost !== undefined && (
                                <span>
                                  Costo total: <strong>{formatCurrency(ev.totalCost)}</strong>
                                </span>
                              )}

                              {ev.declaredSalePrice !== undefined && (
                                <span>
                                  Precio venta: <strong>{formatCurrency(ev.declaredSalePrice)}</strong>
                                </span>
                              )}

                              {ev.reason && (
                                <span className="italic text-slate-600">
                                  «{ev.reason}»
                                </span>
                              )}

                              <span className="text-slate-400">
                                Responsable: <strong className="text-slate-600 font-medium">{ev.responsibleUserId}</strong>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Indicador de impacto numérico */}
                        <div className="text-right shrink-0 pt-2 sm:pt-0">
                          {ev.stockDifference !== undefined && (
                            <div
                              className={`text-sm font-bold ${
                                ev.stockDifference > 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {ev.stockDifference > 0 ? `+${ev.stockDifference}` : ev.stockDifference}{' '}
                              <span className="text-[11px] font-normal text-slate-500">{summary.unitSymbol}</span>
                            </div>
                          )}

                          {ev.priceDifference !== undefined && (
                            <div
                              className={`text-xs font-semibold ${
                                ev.priceDifference > 0 ? 'text-emerald-700' : 'text-amber-700'
                              }`}
                            >
                              {ev.priceDifference > 0 ? `+${formatCurrency(ev.priceDifference)}` : formatCurrency(ev.priceDifference)}
                              {ev.priceChangePercentage !== undefined && (
                                <span className="text-[10px] text-slate-500 ml-1">
                                  ({ev.priceChangePercentage > 0 ? `+${ev.priceChangePercentage}%` : `${ev.priceChangePercentage}%`})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* PESTAÑA 2: KARDEX DE MOVIMIENTOS */}
            {activeTab === 'KARDEX' && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <tr>
                        <th className="px-4 py-3">Fecha y Hora</th>
                        <th className="px-4 py-3">Tipo de Movimiento</th>
                        <th className="px-4 py-3 text-right">Entrada</th>
                        <th className="px-4 py-3 text-right">Salida</th>
                        <th className="px-4 py-3 text-right">Stock Anterior</th>
                        <th className="px-4 py-3 text-right">Stock Resultante</th>
                        <th className="px-4 py-3">Referencia / Motivo</th>
                        <th className="px-4 py-3">Responsable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(paginatedItems as KardexMovementEntry[]).map((k) => (
                        <tr key={k.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-slate-600">
                            {formatDateTime(k.timestamp)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-900">
                            {k.movementTypeLabel}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                            {k.entryQuantity !== null ? `+${k.entryQuantity}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-rose-700">
                            {k.exitQuantity !== null ? `-${k.exitQuantity}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-600">
                            {k.previousStock}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                            {k.resultingStock}
                          </td>
                          <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={k.referenceOrReason}>
                            {k.referenceOrReason}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {k.responsibleUserId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* PESTAÑA 3: ENTRADAS DE MERCANCÍA */}
            {activeTab === 'ENTRIES' && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <tr>
                        <th className="px-4 py-3">Fecha Declarada</th>
                        <th className="px-4 py-3">Registro Real</th>
                        <th className="px-4 py-3 text-right">Cantidad</th>
                        {canViewCosts && <th className="px-4 py-3 text-right">Costo Unitario</th>}
                        {canViewCosts && <th className="px-4 py-3 text-right">Costo Total</th>}
                        <th className="px-4 py-3 text-right">Precio Venta</th>
                        <th className="px-4 py-3">Responsable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(paginatedItems as MerchandiseEntryRecord[]).map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-900">
                            {e.declaredEntryDate}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-slate-500">
                            {formatDateTime(e.registeredAt)}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-900">
                            {e.quantity} {summary.unitSymbol}
                          </td>
                          {canViewCosts && (
                            <td className="px-4 py-3 text-right font-mono text-slate-700">
                              {formatCurrency(e.unitPurchasePrice)}
                            </td>
                          )}
                          {canViewCosts && (
                            <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                              {formatCurrency(e.totalEntryCost)}
                            </td>
                          )}
                          <td className="px-4 py-3 text-right font-mono font-semibold text-[#123F55]">
                            {formatCurrency(e.declaredSalePrice)}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {e.responsibleUserId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* PESTAÑA 4: CAMBIOS DE PRECIOS */}
            {activeTab === 'PRICES' && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <tr>
                        <th className="px-4 py-3">Fecha y Hora</th>
                        <th className="px-4 py-3 text-right">Precio Anterior</th>
                        <th className="px-4 py-3 text-right">Nuevo Precio</th>
                        <th className="px-4 py-3 text-right">Diferencia</th>
                        <th className="px-4 py-3 text-right">Variación</th>
                        <th className="px-4 py-3">Origen / Motivo</th>
                        <th className="px-4 py-3">Responsable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(paginatedItems as PriceChangeRecord[]).map((p) => {
                        const diff = p.newSalePrice - p.previousSalePrice;
                        const pct =
                          p.previousSalePrice > 0
                            ? Math.round(((p.newSalePrice - p.previousSalePrice) / p.previousSalePrice) * 1000) / 10
                            : null;

                        return (
                          <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-slate-600">
                              {formatDateTime(p.changedAt)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-500">
                              {formatCurrency(p.previousSalePrice)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-[#123F55]">
                              {formatCurrency(p.newSalePrice)}
                            </td>
                            <td className={`px-4 py-3 text-right font-mono font-semibold ${
                              diff >= 0 ? 'text-emerald-700' : 'text-rose-700'
                            }`}>
                              {diff > 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-600">
                              {pct !== null ? `${pct > 0 ? `+${pct}%` : `${pct}%`}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={p.reason ?? ''}>
                              {p.reason ?? 'Sin motivo especificado'}
                            </td>
                            <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                              {p.responsibleUserId}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* PESTAÑA 5: CAMBIOS DE ESTADO */}
            {activeTab === 'STATUSES' && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <tr>
                        <th className="px-4 py-3">Fecha y Hora</th>
                        <th className="px-4 py-3">Estado Anterior</th>
                        <th className="px-4 py-3">Estado Nuevo</th>
                        <th className="px-4 py-3">Motivo</th>
                        <th className="px-4 py-3">Responsable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(paginatedItems as ProductStatusChangeRecord[]).map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-slate-600">
                            {formatDateTime(s.changedAt)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-slate-500 font-medium">{s.previousStatus}</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${
                                s.newStatus === ProductStatus.ACTIVE
                                  ? 'bg-emerald-50 text-emerald-800'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {s.newStatus === ProductStatus.ACTIVE ? (
                                <Power className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <PowerOff className="w-3 h-3 text-slate-500" />
                              )}
                              <span>{s.newStatus}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700 max-w-sm truncate" title={s.reason}>
                            {s.reason}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {s.responsibleUserId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* BARRA DE PAGINACIÓN */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 rounded-xl">
                <div className="text-xs text-slate-500">
                  Mostrando{' '}
                  <strong>
                    {startIndex + 1}–{Math.min(startIndex + ITEMS_PER_PAGE, totalItems)}
                  </strong>{' '}
                  de <strong>{totalItems}</strong> registros
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safeCurrentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </Button>
                  <span className="text-xs font-medium text-slate-700 px-2">
                    Página {safeCurrentPage} de {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safeCurrentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
