import React, { useState } from 'react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { FormField, TextInput } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import { MeasurementUnitRecord } from '../../domain/entities/MeasurementUnitRecord';

export interface CreateMeasurementUnitModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated?: (unit: MeasurementUnitRecord) => void;
}

export function CreateMeasurementUnitModal({
  isOpen,
  onClose,
  onCreated,
}: CreateMeasurementUnitModalProps) {
  const { actor } = useSession();
  const { useCases, notifyDataChanged } = useApplication();

  const [name, setName] = useState<string>('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleClose = () => {
    if (isSubmitting) return;
    setName('');
    setErrorText(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErrorText('El nombre de la unidad de medida es obligatorio.');
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);

    try {
      const created = await useCases.warehouse.createMeasurementUnit.execute(actor, {
        name: trimmed,
      });
      notifyDataChanged();
      setName('');
      setErrorText(null);
      if (onCreated) {
        onCreated(created);
      }
      onClose();
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : 'Error al registrar la unidad de medida.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Nueva unidad de medida"
      description="Define una unidad para cuantificar las existencias en inventario."
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
            disabled={isSubmitting || !name.trim()}
            onClick={(e) => void handleSubmit(e)}
          >
            {isSubmitting ? 'Guardando…' : 'Crear unidad'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormField
          id="unit-name-input"
          label="Nombre de la unidad de medida"
          helperText="Ejemplo: Pieza, Kilogramo, Litro, Caja, Paquete."
          errorText={errorText ?? undefined}
        >
          <TextInput
            id="unit-name-input"
            autoFocus
            placeholder="Ingrese el nombre…"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errorText) setErrorText(null);
            }}
            disabled={isSubmitting}
          />
        </FormField>
      </form>
    </Modal>
  );
}
