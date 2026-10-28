import React, { useEffect, useState } from 'react';
import { AlertCircle, History, RotateCcw } from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { Modal } from '../../../../shared/components/Modal';
import { formatCurrency } from '../../../../shared/utils/money';
import { ProductCatalogViewItem } from '../../domain/entities/ProductRecord';
import { WorkdayRecord } from '../../domain/entities/WorkdayRecord';

export interface RectifyFinalInventoryModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly workday: WorkdayRecord;
  readonly onSuccess: () => void;
}

export function RectifyFinalInventoryModal({
  isOpen,
  onClose,
  workday,
  onSuccess,
}: RectifyFinalInventoryModalProps) {
  const { actor } = useSession();
  const { useCases, notifyDataChanged } = useApplication();

  const [products, setProducts] = useState<readonly ProductCatalogViewItem[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [differenceReasons, setDifferenceReasons] = useState<Record<string, string>>({});
  const [rectificationReason, setRectificationReason] = useState<string>('');

  const [isLoadingProducts, setIsLoadingProducts] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setIsLoadingProducts(true);
    setError(null);
    useCases.warehouse.listProducts
      .execute(actor)
      .then((res) => {
        setProducts(res);
        const initialCounts: Record<string, string> = {};
        for (const p of res) {
          initialCounts[p.id] = String(p.stockQuantity);
        }
        setCounts(initialCounts);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Error al cargar productos del catálogo.');
      })
      .finally(() => {
        setIsLoadingProducts(false);
      });
  }, [isOpen, workday.id]);

  const [rectifyPin, setRectifyPin] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rectificationReason.trim()) {
      setError('El motivo de la rectificación es obligatorio.');
      return;
    }
    if (rectifyPin.length !== 6) {
      setError('Ingrese el PIN de 6 dígitos para reautenticar esta acción crítica.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const parsedCounts: Record<string, number> = {};
      for (const [pId, valStr] of Object.entries(counts)) {
        if (valStr !== undefined && valStr.trim() !== '') {
          const num = Number(valStr);
          if (Number.isFinite(num) && num >= 0) {
            parsedCounts[pId] = num;
          }
        }
      }

      const verifyRes = await useCases.core.verifyAdminPin.execute(actor, {
        pin: rectifyPin,
        scope: 'RECTIFY_WORKDAY',
      });

      await useCases.warehouse.rectifyWorkdayClosing.execute(actor, {
        workdayId: workday.id,
        counts: parsedCounts,
        differenceReasons,
        reason: rectificationReason.trim(),
        criticalToken: verifyRes.criticalToken!,
      });

      notifyDataChanged();
      onSuccess();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No fue posible registrar la rectificación del inventario final.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Rectificar Inventario Final — Jornada #${workday.consecutiveNumber} (${workday.code})`}
      description="Esta acción creará una versión rectificada inmutable del conteo de inventario y registrará movimientos de ajuste compensatorios en el Kardex."
      maxWidthClassName="max-w-4xl"
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? 'Procesando rectificación...' : 'Aprobar y aplicar rectificación'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 text-amber-900 space-y-1">
          <div className="font-semibold flex items-center gap-1.5">
            <RotateCcw className="h-4 w-4 text-amber-700 shrink-0" />
            <span>Regla de rectificación de la última jornada cerrada</span>
          </div>
          <p className="text-[11px] leading-relaxed text-amber-800">
            Solo se permite rectificar la jornada cerrada más reciente. La rectificación ajustará
            únicamente las diferencias compensatorias necesarias sobre el stock actual sin alterar las
            ventas históricas ni recalculación de capas FIFO previas.
          </p>
        </div>

        <div className="space-y-1">
          <label className="font-semibold text-slate-700 block">
            Motivo obligatorio de la rectificación <span className="text-red-600">*</span>:
          </label>
          <textarea
            required
            rows={2}
            placeholder="Explique detalladamente la causa del error en el conteo anterior..."
            value={rectificationReason}
            onChange={(e) => setRectificationReason(e.target.value)}
            className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
          />
        </div>

        {isLoadingProducts ? (
          <div className="p-6 text-center text-slate-500">
            Cargando catálogo para rectificación…
          </div>
        ) : (
          <div className="space-y-3">
            <h4 className="font-semibold text-slate-800">
              Captura de cantidades físicas rectificadas ({products.length})
            </h4>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {products.map((p) => {
                const rawCount = counts[p.id] ?? '';
                const newCountNum = rawCount !== '' ? Number(rawCount) : p.stockQuantity;
                const compDiff = Math.round((newCountNum - p.stockQuantity) * 100) / 100;
                return (
                  <div key={p.id} className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-[#123F55]">{p.name}</span>{' '}
                        <span className="font-mono text-[11px] text-slate-500">
                          ({p.code || p.sku || `PRD-${p.id.slice(0, 8).toUpperCase()}`})
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-600">
                        Stock actual en catálogo: <strong>{p.stockQuantity.toFixed(2)}</strong>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Cantidad física rectificada:
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={rawCount}
                          onChange={(e) =>
                            setCounts((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-1 font-mono text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Motivo del ajuste específico:
                        </label>
                        <input
                          type="text"
                          placeholder="Motivo puntual para este producto..."
                          value={differenceReasons[p.id] ?? ''}
                          onChange={(e) =>
                            setDifferenceReasons((prev) => ({
                              ...prev,
                              [p.id]: e.target.value,
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="text-[11px] font-mono text-slate-600">
                      Ajuste compensatorio en Kardex:{' '}
                      <strong
                        className={
                          compDiff < 0
                            ? 'text-red-700'
                            : compDiff > 0
                              ? 'text-blue-700'
                              : 'text-emerald-700'
                        }
                      >
                        {compDiff > 0 ? `+${compDiff.toFixed(2)}` : compDiff.toFixed(2)}
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
          <label htmlFor="rectify-pin-input" className="block text-xs font-semibold text-slate-800">
            Reautenticación por PIN de Administrador (6 dígitos)
          </label>
          <p className="text-[11px] text-slate-500">
            Ingrese su PIN actual para reautenticar y autorizar la emisión de la versión rectificada inmutable.
          </p>
          <input
            id="rectify-pin-input"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={rectifyPin}
            onChange={(e) => {
              setRectifyPin(e.target.value.replace(/\D/g, '').slice(0, 6));
              if (error) setError(null);
            }}
            placeholder="••••••"
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-center text-sm font-mono tracking-widest text-slate-900 focus:border-[#123F55] focus:outline-none"
          />
        </div>
      </form>
    </Modal>
  );
}
