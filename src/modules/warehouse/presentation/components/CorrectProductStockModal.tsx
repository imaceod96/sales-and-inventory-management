import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Minus,
  SlidersHorizontal,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { FormField, TextInput } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import {
  ProductCatalogViewItem,
  ProductRecord,
  ProductStatus,
} from '../../domain/entities/ProductRecord';

export interface CorrectProductStockModalProps {
  readonly isOpen: boolean;
  readonly product: ProductCatalogViewItem | null;
  readonly onClose: () => void;
  readonly onSuccess: (product: ProductRecord, message: string) => void;
}

export function CorrectProductStockModal({
  isOpen,
  product,
  onClose,
  onSuccess,
}: CorrectProductStockModalProps) {
  if (!isOpen || !product) return null;

  const { actor } = useSession();
  const { useCases, notifyDataChanged } = useApplication();

  // Valores de referencia iniciales para control estricto de concurrencia
  const initialStock = product.stockQuantity;
  const initialUpdatedAt = product.updatedAt;

  const [physicalStockInput, setPhysicalStockInput] = useState<string>(initialStock.toString());
  const [reason, setReason] = useState<string>('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Cálculo en vivo de la diferencia y el tipo de ajuste
  const parsedPhysicalStock = parseFloat(physicalStockInput);
  const isInputValidNumber = !isNaN(parsedPhysicalStock) && parsedPhysicalStock >= 0;

  const summary = useMemo(() => {
    if (!isInputValidNumber) {
      return {
        isValid: false,
        difference: null,
        resultingStock: null,
        adjustmentType: null,
        isZeroDiff: false,
        error: parsedPhysicalStock < 0 ? 'La existencia no puede ser negativa.' : 'Ingrese un valor numérico válido.',
      };
    }

    const decimals = (physicalStockInput.split('.')[1] || '').length;
    if (decimals > 2) {
      return {
        isValid: false,
        difference: null,
        resultingStock: null,
        adjustmentType: null,
        isZeroDiff: false,
        error: 'La existencia física admite como máximo dos decimales.',
      };
    }

    if (parsedPhysicalStock > 9999999.99) {
      return {
        isValid: false,
        difference: null,
        resultingStock: null,
        adjustmentType: null,
        isZeroDiff: false,
        error: 'La cantidad excede el límite numérico admitido.',
      };
    }

    const normalizedStock = Math.round(parsedPhysicalStock * 100) / 100;
    const diff = Math.round((normalizedStock - initialStock) * 100) / 100;
    const isZeroDiff = Math.abs(diff) < 0.0001;

    let adjustmentType: 'POSITIVE' | 'NEGATIVE' | 'ZERO' = 'ZERO';
    if (diff > 0) adjustmentType = 'POSITIVE';
    else if (diff < 0) adjustmentType = 'NEGATIVE';

    return {
      isValid: true,
      difference: diff,
      resultingStock: normalizedStock,
      adjustmentType,
      isZeroDiff,
      error: null,
    };
  }, [physicalStockInput, isInputValidNumber, parsedPhysicalStock, initialStock]);

  const handleClose = () => {
    if (isSubmitting) return;
    setErrorText(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (!summary.isValid || summary.resultingStock === null) {
      setErrorText(summary.error || 'Ingrese una existencia física válida mayor o igual a cero.');
      return;
    }

    if (summary.isZeroDiff) {
      setErrorText(
        'La existencia física coincide exactamente con la registrada en el sistema. No hay diferencias que ajustar.'
      );
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setErrorText('El motivo de la corrección de existencias es obligatorio.');
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);

    try {
      const result = await useCases.warehouse.correctProductStock.execute(actor, {
        productId: product.id,
        realPhysicalStock: summary.resultingStock,
        expectedPreviousStock: initialStock,
        expectedUpdatedAt: initialUpdatedAt,
        reason: trimmedReason,
      });

      notifyDataChanged();
      const diffLabel = result.difference > 0 ? `+${result.difference}` : `${result.difference}`;
      onSuccess(
        result.product,
        `Existencias de «${result.product.name}» regularizadas de ${initialStock} a ${result.product.currentStock} ${product.unitLabel} (${diffLabel}).`
      );
      onClose();
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : 'Error al procesar la corrección de existencias.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPositive = summary.adjustmentType === 'POSITIVE';
  const isNegative = summary.adjustmentType === 'NEGATIVE';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Corregir existencias de inventario"
      description="Regulariza las existencias registradas en el sistema para que coincidan con el conteo físico real en almacén."
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={isSubmitting}
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={isSubmitting || summary.isZeroDiff || !summary.isValid}
            onClick={(e) => void handleSubmit(e)}
          >
            {isSubmitting ? 'Guardando ajuste…' : 'Confirmar corrección'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* Ficha técnica del producto (Solo lectura) */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">{product.name}</div>
              <div className="text-xs text-slate-500">
                Código: {product.code} {product.sku ? `· SKU: ${product.sku}` : ''}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                Estado administrativo
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold mt-0.5 ${
                  product.status === ProductStatus.ACTIVE
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-300'
                }`}
              >
                {product.status === ProductStatus.ACTIVE ? 'Activo' : 'Inactivo'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 text-xs">
            <div>
              <span className="text-slate-500 block">Categoría:</span>
              <span className="font-medium text-slate-800">{product.categoryLabel}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Unidad de medida:</span>
              <span className="font-medium text-slate-800">{product.unitLabel}</span>
            </div>
            <div className="text-right">
              <span className="text-slate-500 block">Existencia en sistema:</span>
              <span className="font-bold text-[#123F55] text-sm tabular-nums">
                {initialStock.toFixed(2)} {product.unitLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Mensaje de error general si ocurre */}
        {errorText && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-700" />
            <span className="leading-relaxed">{errorText}</span>
          </div>
        )}

        {/* Campo 1: Existencia física real */}
        <FormField
          id="real-physical-stock-input"
          label="Existencia física real *"
          helperText="Cantidad verificada físicamente en el establecimiento (mayor o igual a cero, hasta dos decimales)."
          errorText={summary.error ?? undefined}
        >
          <TextInput
            id="real-physical-stock-input"
            type="number"
            min="0"
            step="any"
            autoFocus
            placeholder="Ej. 22"
            value={physicalStockInput}
            onChange={(e) => {
              setPhysicalStockInput(e.target.value);
              if (errorText) setErrorText(null);
            }}
            leadingIcon={<SlidersHorizontal className="h-4 w-4" />}
            disabled={isSubmitting}
          />
        </FormField>

        {/* Resumen dinámico del ajuste */}
        <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3">
          <div className="text-xs font-semibold text-slate-800 flex items-center justify-between">
            <span>Resumen del ajuste compensatorio</span>
            {summary.isZeroDiff && (
              <span className="text-[11px] font-normal text-slate-500 flex items-center gap-1">
                <Minus className="h-3 w-3" /> Sin diferencia
              </span>
            )}
            {isPositive && (
              <span className="text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1">
                <ArrowUpRight className="h-3.5 w-3.5 text-emerald-700" />
                Sobrante (+{summary.difference})
              </span>
            )}
            {isNegative && (
              <span className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">
                <ArrowDownRight className="h-3.5 w-3.5 text-amber-700" />
                Faltante ({summary.difference})
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs text-center">
            <div className="p-2 rounded bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Existencia anterior</span>
              <span className="font-semibold text-slate-800 text-sm tabular-nums">
                {initialStock.toFixed(2)}
              </span>
            </div>

            <div
              className={`p-2 rounded border ${
                summary.isZeroDiff
                  ? 'bg-slate-50 border-slate-200'
                  : isPositive
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : 'bg-amber-50/70 border-amber-200'
              }`}
            >
              <span className="text-slate-500 block text-[11px]">Diferencia</span>
              <span
                className={`font-bold text-sm tabular-nums ${
                  summary.isZeroDiff
                    ? 'text-slate-600'
                    : isPositive
                    ? 'text-emerald-700'
                    : 'text-amber-800'
                }`}
              >
                {summary.difference !== null
                  ? summary.difference > 0
                    ? `+${summary.difference.toFixed(2)}`
                    : summary.difference.toFixed(2)
                  : '—'}
              </span>
            </div>

            <div className="p-2 rounded bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Existencia resultante</span>
              <span className="font-bold text-[#123F55] text-sm tabular-nums">
                {summary.resultingStock !== null ? summary.resultingStock.toFixed(2) : '—'}
              </span>
            </div>
          </div>

          {summary.isZeroDiff && (
            <div className="flex items-center gap-2 rounded bg-slate-50 p-2.5 text-xs text-slate-600 border border-slate-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-slate-500" />
              <span>
                La existencia física declarada coincide exactamente con la registrada actualmente en el sistema. Modifique la cantidad física para regularizar diferencias.
              </span>
            </div>
          )}

          {isNegative && (
            <div className="flex items-center gap-2 rounded bg-amber-50/70 p-2 text-xs text-amber-800 border border-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
              <span>
                Se registrará un ajuste de faltante por {Math.abs(summary.difference || 0)} {product.unitLabel}.
              </span>
            </div>
          )}
        </div>

        {/* Campo 2: Motivo obligatorio de la corrección */}
        <FormField
          id="stock-correction-reason"
          label="Motivo de la corrección *"
          helperText="Explique la causa de la discrepancia (quedará registrado en el kardex y la auditoría)."
        >
          <TextInput
            id="stock-correction-reason"
            placeholder="Ej. Conteo físico de almacén / Merma por rotura / Corrección por error de captura previo"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (errorText) setErrorText(null);
            }}
            disabled={isSubmitting}
          />
        </FormField>
      </form>
    </Modal>
  );
}
