import React, { useMemo, useState } from 'react';
import { AlertCircle, DollarSign, TrendingUp } from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { FormField, TextInput } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import { Permission } from '../../../../shared/types/permissions';
import { calculateProfitMarginPercentage } from '../../../../shared/utils/money';
import { ProductCatalogViewItem, ProductRecord } from '../../domain/entities/ProductRecord';

export interface EditProductSalePriceModalProps {
  readonly isOpen: boolean;
  readonly product: ProductCatalogViewItem | null;
  readonly onClose: () => void;
  readonly onSuccess: (product: ProductRecord, message: string) => void;
}

export function EditProductSalePriceModal({
  isOpen,
  product,
  onClose,
  onSuccess,
}: EditProductSalePriceModalProps) {
  if (!isOpen || !product) return null;

  const { actor, can } = useSession();
  const { useCases, notifyDataChanged } = useApplication();
  const canViewCosts = can(Permission.VIEW_PRODUCT_COSTS);

  const [newSalePrice, setNewSalePrice] = useState<string>(product.salePrice.toString());
  const [reason, setReason] = useState<string>('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const parsedPrice = parseFloat(newSalePrice);
  const isValidNumber = !isNaN(parsedPrice) && parsedPrice > 0;
  const integerPrice = isValidNumber ? Math.ceil(parsedPrice) : null;
  const purchaseCost = product.purchaseCost ?? 0;

  const isBelowCost = Boolean(
    canViewCosts && integerPrice !== null && purchaseCost > 0 && integerPrice < purchaseCost
  );

  const projectedMargin = useMemo(() => {
    if (integerPrice === null || purchaseCost <= 0) return null;
    return calculateProfitMarginPercentage(integerPrice, purchaseCost);
  }, [integerPrice, purchaseCost]);

  const handleClose = () => {
    if (isSubmitting) return;
    setErrorText(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (integerPrice === null || integerPrice <= 0) {
      setErrorText('El precio de venta debe ser un valor numérico mayor que cero.');
      return;
    }

    if (purchaseCost > 0 && integerPrice < purchaseCost) {
      setErrorText(
        `El precio de venta ($${integerPrice}) no puede ser inferior al último costo de compra ($${purchaseCost.toFixed(2)}).`
      );
      return;
    }

    if (integerPrice === product.salePrice) {
      setErrorText(
        `El nuevo precio ($${integerPrice}) debe ser diferente al precio de venta actual ($${product.salePrice}).`
      );
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setErrorText('El motivo de la modificación del precio de venta es obligatorio.');
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);

    try {
      const result = await useCases.warehouse.updateProductSalePrice.execute(actor, {
        productId: product.id,
        newSalePrice: integerPrice,
        reason: trimmedReason,
      });
      notifyDataChanged();
      onSuccess(
        result.product,
        `Precio de venta de «${result.product.name}» actualizado de $${product.salePrice} a $${result.product.currentSalePrice}.`
      );
      onClose();
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : 'Error al actualizar el precio de venta.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Modificar Precio de Venta"
      description="Actualiza el precio de venta al público conservando intactos el último costo y el historial de existencias."
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
            disabled={isSubmitting}
            onClick={(e) => void handleSubmit(e)}
          >
            {isSubmitting ? 'Guardando cambios…' : 'Actualizar precio'}
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

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 text-xs">
            {canViewCosts && (
              <div>
                <span className="text-slate-500">Último costo de compra:</span>
                <div className="font-semibold text-slate-900 tabular-nums">
                  ${purchaseCost.toFixed(2)}
                </div>
              </div>
            )}
            <div>
              <span className="text-slate-500">Precio de venta actual:</span>
              <div className="font-semibold text-[#123F55] tabular-nums">
                ${product.salePrice}
              </div>
            </div>
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

        {/* Input de nuevo precio */}
        <FormField
          id="new-sale-price-input"
          label="Nuevo precio de venta ($) *"
          helperText="Pesos enteros. Si introduce decimales, se redondeará automáticamente al entero superior."
        >
          <TextInput
            id="new-sale-price-input"
            type="number"
            min="1"
            step="1"
            autoFocus
            placeholder="Ej. 150"
            value={newSalePrice}
            onChange={(e) => {
              setNewSalePrice(e.target.value);
              if (errorText) setErrorText(null);
            }}
            leadingIcon={<DollarSign className="h-4 w-4" />}
            disabled={isSubmitting}
          />
        </FormField>

        {/* Simulación en tiempo real del margen */}
        {canViewCosts && integerPrice !== null && (
          <div
            className={`flex items-center justify-between rounded-lg border p-3 text-xs ${
              isBelowCost
                ? 'border-rose-200 bg-rose-50/70 text-rose-900'
                : 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <TrendingUp
                className={`h-4 w-4 shrink-0 ${
                  isBelowCost ? 'text-rose-600' : 'text-emerald-700'
                }`}
              />
              <span>
                {isBelowCost ? (
                  <strong>Advertencia: Precio inferior al costo de compra</strong>
                ) : (
                  <span>Margen de ganancia proyectado:</span>
                )}
              </span>
            </div>
            <div className="font-semibold tabular-nums">
              {isBelowCost ? (
                <span className="text-rose-700">No permitido</span>
              ) : (
                <span className="text-emerald-800">
                  {projectedMargin !== null ? `+${projectedMargin.toFixed(2)}%` : '—'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Motivo de la modificación */}
        <FormField
          id="price-change-reason"
          label="Motivo de la modificación de precio *"
          helperText="Se registrará en el historial inmutable de cambios de precio y auditoría."
        >
          <TextInput
            id="price-change-reason"
            placeholder="Ej. Ajuste inflacionario / Estrategia comercial de temporada"
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
