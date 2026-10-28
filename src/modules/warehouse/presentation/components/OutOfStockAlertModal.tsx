import { AlertTriangle, ExternalLink, Package, X } from 'lucide-react';
import { Button } from '../../../../shared/components/Button';
import { Modal } from '../../../../shared/components/Modal';
import { OutOfStockProductItem } from '../../application/GetOutOfStockProductsUseCase';

export interface OutOfStockAlertModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly products: readonly OutOfStockProductItem[];
  readonly onSelectProduct: (productId: string) => void;
}

export function OutOfStockAlertModal({
  isOpen,
  onClose,
  products,
  onSelectProduct,
}: OutOfStockAlertModalProps) {
  const count = products.length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Productos agotados (${count})`}
      description="Listado de artículos activos con existencia física en cero. No se muestran datos de costos ni márgenes confidenciales."
      maxWidthClassName="max-w-2xl"
      footer={
        <Button variant="secondary" size="md" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {count === 0 ? (
        <div className="py-8 text-center">
          <Package className="mx-auto h-10 w-10 text-emerald-500 opacity-60" />
          <h4 className="mt-3 text-sm font-semibold text-slate-800">
            Almacén abastecido
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Actualmente no hay productos activos con existencias en cero.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 -mx-2 px-2">
          {products.map((item) => (
            <div
              key={item.id}
              className="py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50/60 rounded px-2 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-900 truncate">
                    {item.name}
                  </span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                    Agotado
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
                  <span>Código: <strong className="font-medium text-slate-700">{item.code}</strong></span>
                  {item.sku && (
                    <span>SKU: <strong className="font-medium text-slate-700">{item.sku}</strong></span>
                  )}
                  <span>Categoría: <strong className="font-medium text-slate-700">{item.categoryName}</strong></span>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-xs font-bold text-red-600 font-mono">0.00 existencias</div>
                  <div className="text-[11px] text-slate-500 font-medium">
                    Precio: ${item.salePrice.toFixed(2)}
                  </div>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ExternalLink className="h-3 w-3" />}
                  onClick={() => onSelectProduct(item.id)}
                  title={`Ver historial de ${item.name}`}
                >
                  Historial
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

