import { useMemo, useState } from 'react';
import { ArrowLeft, Eye, History, PackageCheck, Printer, Search, XCircle } from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { ROUTES } from '../../../../app/router/routes';
import { useRouter } from '../../../../app/router/RouterProvider';
import { Button } from '../../../../shared/components/Button';
import { Card } from '../../../../shared/components/Card';
import { DataTable, TableColumn } from '../../../../shared/components/DataTable';
import { TextInput } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import { PageHeader } from '../../../../shared/components/PageHeader';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime } from '../../../../shared/utils/date';
import { formatCurrency } from '../../../../shared/utils/money';
import {
  formatSaleDisplayLabel,
  SaleRecord,
  SaleStatus,
} from '../../domain/entities/SaleRecord';
import { calculateCommercialPerformance } from '../../../warehouse/domain/entities/WorkdayCommercialPerformance';
import { DispatchReceiptModal } from '../components/DispatchReceiptModal';

type HistoryFilter = 'ALL' | SaleStatus.DISPATCHED | SaleStatus.CANCELLED;

export function SalesHistoryPage() {
  const { actor, can } = useSession();
  const { useCases, dataRevision } = useApplication();
  const { navigate } = useRouter();

  const canViewCosts = can(Permission.VIEW_PRODUCT_COSTS);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<HistoryFilter>('ALL');
  const [selectedDetailSale, setSelectedDetailSale] = useState<SaleRecord | null>(null);
  const [receiptModalSale, setReceiptModalSale] = useState<SaleRecord | null>(null);

  const { data: salesHistory, isLoading } = useAsyncQuery(
    () => useCases.sales.getSalesHistory.execute(actor),
    [useCases.sales.getSalesHistory, actor, dataRevision]
  );

  const filteredRows = useMemo(() => {
    const list = salesHistory ?? [];
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return list.filter((sale) => {
      const isDispatched =
        sale.status === SaleStatus.DISPATCHED ||
        (sale.status as string) === 'COMPLETED';

      if (statusFilter === SaleStatus.DISPATCHED && !isDispatched) {
        return false;
      }
      if (
        statusFilter === SaleStatus.CANCELLED &&
        sale.status !== SaleStatus.CANCELLED
      ) {
        return false;
      }
      if (!normalizedSearch) return true;
      const folioMatch = sale.folio.toLowerCase().includes(normalizedSearch);
      const refMatch = (sale.accountName ?? sale.customerOrTableLabel ?? '')
        .toLowerCase()
        .includes(normalizedSearch);
      return folioMatch || refMatch;
    });
  }, [salesHistory, searchQuery, statusFilter]);

  const historyPerformance = useMemo(() => {
    return calculateCommercialPerformance(filteredRows);
  }, [filteredRows]);

  const columns: readonly TableColumn<SaleRecord>[] = [
    {
      key: 'folio',
      header: 'Folio / Cuenta',
      tabular: true,
      render: (row) => (
        <span className="font-semibold text-[#123F55]">
          {formatSaleDisplayLabel(row)}
        </span>
      ),
    },
    {
      key: 'originType',
      header: 'Modalidad',
      render: (row) =>
        row.originType === 'DIRECT_DISPATCH' ? (
          <span className="text-xs text-slate-600">Despacho directo</span>
        ) : (
          <span className="text-xs text-slate-700 font-medium">Cuenta abierta</span>
        ),
    },
    {
      key: 'itemsCount',
      header: 'Partidas',
      align: 'right',
      tabular: true,
      render: (row) => (
        <span className="font-mono text-xs text-slate-700">
          {row.items?.length ?? 0}
        </span>
      ),
    },
    {
      key: 'totalAmount',
      header: 'Importe Total',
      align: 'right',
      tabular: true,
      render: (row) => (
        <span className="font-mono text-xs font-bold text-slate-900">
          {formatCurrency(row.totalAmount ?? 0)}
        </span>
      ),
    },
    {
      key: 'closedAt',
      header: 'Fecha despacho / cierre',
      tabular: true,
      render: (row) =>
        formatDateTime(row.dispatchedAt ?? row.cancelledAt ?? row.closedAt),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (row) =>
        row.status === SaleStatus.DISPATCHED ||
        (row.status as string) === 'COMPLETED' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            <PackageCheck className="h-3 w-3" />
            Despachada
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            <XCircle className="h-3 w-3" />
            Cancelada
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'Detalle',
      align: 'right',
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          icon={<Eye className="h-3.5 w-3.5" />}
          onClick={() => setSelectedDetailSale(row)}
        >
          Ver detalle
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Historial de ventas y despachos"
        subtitle="Consulta cronológica de las operaciones despachadas y cuentas abiertas canceladas."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => navigate(ROUTES.openSales)}
            >
              Ir a mesa de ventas
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => navigate(ROUTES.home)}
            >
              Volver al inicio
            </Button>
          </div>
        }
      />

      {canViewCosts && historyPerformance && historyPerformance.totalDispatchesCount > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-[#123F55] uppercase tracking-wider">
              Rendimiento Comercial — Historial Filtrado ({historyPerformance.totalDispatchesCount} despachos)
            </h3>
            <span className="text-[11px] text-slate-500">Valor Comercial − Costo FIFO Atribuido</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <span className="text-slate-500 text-[11px] block">1. Valor Comercial Despachado</span>
              <strong className="text-base font-bold font-mono text-[#123F55] mt-0.5 block">
                {formatCurrency(historyPerformance.totalCommercialValue)}
              </strong>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <span className="text-slate-500 text-[11px] block">2. Costo de Compra Atribuido (FIFO)</span>
              <strong className="text-base font-bold font-mono text-slate-800 mt-0.5 block">
                {historyPerformance.hasUnknownCosts ? (
                  <span className="text-amber-800 text-xs italic">Pendiente de valoración</span>
                ) : (
                  formatCurrency(historyPerformance.totalCostOfGoodsDispatched)
                )}
              </strong>
            </div>

            <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3">
              <span className="text-emerald-900 font-semibold text-[11px] block">3. Ganancia Bruta / Utilidad Bruta</span>
              <strong
                className={`text-base font-bold font-mono mt-0.5 block ${
                  historyPerformance.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {historyPerformance.hasUnknownCosts ? (
                  <span className="text-amber-800 text-xs italic">Pendiente de valoración</span>
                ) : (
                  formatCurrency(historyPerformance.grossProfit)
                )}
              </strong>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <span className="text-slate-500 text-[11px] block">4. Margen Bruto %</span>
              <strong className="text-base font-bold font-mono text-[#1A5F7A] mt-0.5 block">
                {historyPerformance.hasUnknownCosts ? (
                  <span className="text-amber-800 text-xs italic">N/A</span>
                ) : (
                  `${historyPerformance.grossMarginPercentage.toFixed(2)}%`
                )}
              </strong>
            </div>
          </div>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="w-full max-w-sm">
            <TextInput
              aria-label="Buscar en el historial de ventas"
              placeholder="Buscar por folio (#001, VD-0001) o nombre de cuenta…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leadingIcon={<Search className="h-4 w-4" />}
            />
          </div>

          <div
            role="group"
            aria-label="Filtrar por estado de venta"
            className="flex items-center gap-1 rounded-lg bg-[#F8F9FA] p-1 border border-slate-200"
          >
            {(
              [
                { key: 'ALL', label: 'Todas' },
                { key: SaleStatus.DISPATCHED, label: 'Despachadas' },
                { key: SaleStatus.CANCELLED, label: 'Canceladas' },
              ] as const
            ).map((option) => {
              const active = statusFilter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setStatusFilter(option.key)}
                  className={[
                    'h-8 rounded-md px-3 text-xs font-medium transition-colors duration-150 whitespace-nowrap cursor-pointer',
                    active
                      ? 'bg-[#1A5F7A] text-white'
                      : 'text-slate-600 hover:text-[#123F55]',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={filteredRows}
          getRowKey={(row) => row.id}
          isLoading={isLoading}
          emptyIcon={<History className="h-5 w-5" />}
          emptyTitle={
            searchQuery.trim()
              ? 'Sin coincidencias para la búsqueda'
              : 'No existen operaciones en el historial'
          }
          emptyDescription={
            searchQuery.trim()
              ? 'Verifica el folio o restablece los criterios de filtrado.'
              : 'Cuando se despachen ventas o se cancelen cuentas abiertas, quedarán registradas aquí.'
          }
        />
      </Card>

      {/* Modal de detalle inmutable de despacho o cuenta cancelada */}
      <Modal
        isOpen={Boolean(selectedDetailSale)}
        onClose={() => setSelectedDetailSale(null)}
        title={
          selectedDetailSale
            ? `Detalle de operación · ${formatSaleDisplayLabel(selectedDetailSale)}`
            : 'Detalle de operación'
        }
        description={
          selectedDetailSale?.status === SaleStatus.CANCELLED
            ? 'Cuenta abierta cancelada antes de despachar mercancía.'
            : 'Registro histórico inmutable de despacho de mercancía.'
        }
        footer={
          <div className="flex items-center justify-between w-full">
            {selectedDetailSale &&
            (selectedDetailSale.status === SaleStatus.DISPATCHED ||
              (selectedDetailSale.status as string) === 'COMPLETED') ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Printer className="h-4 w-4" />}
                onClick={() => setReceiptModalSale(selectedDetailSale)}
              >
                Reimprimir Comprobante
              </Button>
            ) : (
              <div />
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => setSelectedDetailSale(null)}
            >
              Cerrar
            </Button>
          </div>
        }
      >
        {selectedDetailSale && (
          <div className="space-y-4 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Folio / Identificador:</span>
                <strong className="font-mono text-slate-900">
                  {formatSaleDisplayLabel(selectedDetailSale)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Apertura:</span>
                <span className="text-slate-800">
                  {formatDateTime(selectedDetailSale.openedAt)} (
                  {selectedDetailSale.openedByUserLabel ?? 'Sesión local'})
                </span>
              </div>
              {selectedDetailSale.dispatchedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Despacho confirmado:</span>
                  <strong className="text-emerald-700">
                    {formatDateTime(selectedDetailSale.dispatchedAt)} (
                    {selectedDetailSale.dispatchedByUserLabel ?? 'Sesión local'})
                  </strong>
                </div>
              )}
              {selectedDetailSale.cancelledAt && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cancelación:</span>
                    <strong className="text-red-700">
                      {formatDateTime(selectedDetailSale.cancelledAt)} (
                      {selectedDetailSale.cancelledByUserLabel ?? 'Sesión local'})
                    </strong>
                  </div>
                  <div className="pt-1 border-t border-slate-200">
                    <span className="text-slate-500 block">Motivo de cancelación:</span>
                    <p className="mt-0.5 font-medium text-red-800 italic">
                      {selectedDetailSale.cancellationReason}
                    </p>
                  </div>
                </>
              )}
            </div>

            {selectedDetailSale.items && selectedDetailSale.items.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2 text-right">Cant.</th>
                      <th className="px-3 py-2 text-right">Precio unit.</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {selectedDetailSale.items.map((item) => (
                      <tr key={item.productId}>
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {item.productName}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700">
                          {item.quantity} {item.unitSymbol || item.unitName}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700">
                          {formatCurrency(item.unitSalePrice)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">
                          {formatCurrency(item.lineSubtotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
              <span className="font-semibold text-slate-700">Importe total:</span>
              <span className="font-mono text-base font-bold text-[#123F55]">
                {formatCurrency(selectedDetailSale.totalAmount ?? 0)}
              </span>
            </div>
          </div>
        )}
      </Modal>

      <DispatchReceiptModal
        isOpen={Boolean(receiptModalSale)}
        onClose={() => setReceiptModalSale(null)}
        sale={receiptModalSale}
      />
    </div>
  );
}
