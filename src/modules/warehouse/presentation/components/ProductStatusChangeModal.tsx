import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
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

export interface ProductStatusChangeModalProps {
  readonly isOpen: boolean;
  readonly product: ProductCatalogViewItem | null;
  readonly targetStatus: ProductStatus;
  readonly onClose: () => void;
  readonly onSuccess: (product: ProductRecord, message: string) => void;
}

export function ProductStatusChangeModal({
  isOpen,
  product,
  targetStatus,
  onClose,
  onSuccess,
}: ProductStatusChangeModalProps) {
  const { actor } = useSession();
  const { useCases, notifyDataChanged } = useApplication();

  const [reason, setReason] = useState<string>('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!product) return null;

  const isDeactivation = targetStatus === ProductStatus.INACTIVE;

  const handleClose = () => {
    if (isSubmitting) return;
    setReason('');
    setErrorText(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setErrorText('El motivo del cambio de estado administrativo es obligatorio.');
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);

    try {
      if (isDeactivation) {
        const result = await useCases.warehouse.deactivateProduct.execute(actor, {
          productId: product.id,
          reason: trimmedReason,
        });
        notifyDataChanged();
        onSuccess(
          result.product,
          `Producto «${result.product.name}» desactivado exitosamente.`
        );
      } else {
        const result = await useCases.warehouse.activateProduct.execute(actor, {
          productId: product.id,
          reason: trimmedReason,
        });
        notifyDataChanged();
        onSuccess(
          result.product,
          `Producto «${result.product.name}» reactivado exitosamente.`
        );
      }
      setReason('');
      setErrorText(null);
      onClose();
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : 'Error al actualizar el estado del producto.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isDeactivation ? 'Desactivar Producto' : 'Activar Producto'}
      description={
        isDeactivation
          ? 'Suspende la disponibilidad comercial y operativa del artículo en el catálogo.'
          : 'Habilita el artículo para su comercialización y recepción de mercancía.'
      }
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
            variant={isDeactivation ? 'danger' : 'primary'}
            size="md"
            disabled={isSubmitting || !reason.trim()}
            onClick={(e) => void handleSubmit(e)}
          >
            {isSubmitting
              ? isDeactivation
                ? 'Desactivando…'
                : 'Activando…'
              : isDeactivation
              ? 'Confirmar desactivación'
              : 'Confirmar activación'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* Ficha resumen del producto */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">{product.name}</div>
              <div className="text-xs text-slate-500">
                Código: {product.code} {product.sku ? `· SKU: ${product.sku}` : ''}
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-500">Existencia actual:</span>
              <div className="text-sm font-semibold text-slate-900">
                {product.stockQuantity.toFixed(2)} {product.unitLabel}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-slate-200 text-xs">
            <span className="text-slate-500">Estado actual:</span>
            <span
              className={`font-medium ${
                product.status === ProductStatus.ACTIVE
                  ? 'text-emerald-700'
                  : 'text-slate-500'
              }`}
            >
              {product.status === ProductStatus.ACTIVE ? 'Activo' : 'Inactivo'}
            </span>
            <span className="text-slate-400">→</span>
            <span className="text-slate-500">Nuevo estado:</span>
            <span
              className={`font-semibold ${
                targetStatus === ProductStatus.ACTIVE
                  ? 'text-emerald-700'
                  : 'text-amber-800'
              }`}
            >
              {targetStatus === ProductStatus.ACTIVE ? 'Activo' : 'Inactivo'}
            </span>
          </div>
        </div>

        {/* Advertencia contextual */}
        <div
          className={`flex items-start gap-2.5 rounded-lg border p-3 text-xs leading-relaxed ${
            isDeactivation
              ? 'border-amber-200 bg-amber-50/70 text-amber-900'
              : 'border-sky-200 bg-sky-50/70 text-sky-900'
          }`}
        >
          {isDeactivation ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-700 mt-0.5" />
          )}
          <div>
            {isDeactivation ? (
              <>
                Al desactivar este producto, no se permitirá agregar nuevas entradas de
                mercancía ni realizar operaciones de venta con él. Sus existencias ({product.stockQuantity.toFixed(2)} {product.unitLabel})
                y su historial quedarán estrictamente preservados en el sistema.
              </>
            ) : (
              <>
                Al reactivar este producto, volverá a estar disponible para recibir nuevas
                entradas de mercancía y para registrar ventas en mostrador de acuerdo a sus
                existencias registradas.
              </>
            )}
          </div>
        </div>

        {errorText && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
            <span>{errorText}</span>
          </div>
        )}

        <FormField
          id="status-change-reason"
          label="Motivo del cambio de estado *"
          helperText="El motivo quedará registrado en el historial inmutable de auditoría."
        >
          <TextInput
            id="status-change-reason"
            autoFocus
            placeholder={
              isDeactivation
                ? 'Ej. Producto descontinuado por proveedor / Cambio de presentación'
                : 'Ej. Reactivación de catálogo por nuevo lote'
            }
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
