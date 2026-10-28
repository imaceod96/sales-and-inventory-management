import React, { useState } from 'react';
import { Printer, Check, Info } from 'lucide-react';
import { Modal } from '../../../../shared/components/Modal';
import { Button } from '../../../../shared/components/Button';
import { formatCurrency } from '../../../../shared/utils/money';
import { formatDateTime } from '../../../../shared/utils/date';
import {
  formatSaleDisplayLabel,
  SaleRecord,
} from '../../domain/entities/SaleRecord';
import { PaperWidth, PrintableReceipt } from '../../../core/domain/ports/PrinterPort';
import { useApplication } from '../../../../app/providers/ApplicationProvider';

interface DispatchReceiptModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly sale: SaleRecord | null;
}

export function DispatchReceiptModal({
  isOpen,
  onClose,
  sale,
}: DispatchReceiptModalProps) {
  const { printerPort } = useApplication();
  const [paperWidth, setPaperWidth] = useState<PaperWidth>('80mm');
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [printedSuccess, setPrintedSuccess] = useState<boolean>(false);

  if (!sale) return null;

  const receipt: PrintableReceipt = {
    title: 'COMPROBANTE DE DESPACHO',
    subtitle: 'Control Comercial de Inventario',
    folio: formatSaleDisplayLabel(sale),
    dateISO: sale.dispatchedAt || sale.closedAt || sale.openedAt,
    accountName: sale.accountName ?? undefined,
    customerOrTableLabel: sale.customerOrTableLabel ?? undefined,
    items: (sale.items || []).map((i) => ({
      productId: i.productId,
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: i.unitSalePrice,
      subtotal: i.lineSubtotal,
      unitSymbol: i.unitSymbol || i.unitName,
    })),
    totalAmount: sale.totalAmount || 0,
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintedSuccess(false);
    try {
      await printerPort.printReceipt(receipt, { paperWidth });
      setPrintedSuccess(true);
      setTimeout(() => setPrintedSuccess(false), 3000);
    } catch {
      // Manejo silencioso en caso de cancelación del usuario
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Comprobante de Despacho · ${formatSaleDisplayLabel(sale)}`}
      description="Vista previa e impresión de comprobante térmico para entrega física de mercancía."
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Info className="h-4 w-4 text-slate-400 shrink-0" />
            <span>Documento de despacho sin información de pago ni costos.</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cerrar
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={printedSuccess ? <Check className="h-4 w-4 text-emerald-300" /> : <Printer className="h-4 w-4" />}
              onClick={handlePrint}
              disabled={isPrinting}
            >
              {printedSuccess ? 'Enviado a impresora' : isPrinting ? 'Imprimiendo…' : 'Imprimir Comprobante'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Selector de Ancho de Papel Térmico */}
        <div className="flex items-center justify-between bg-slate-100 p-2.5 rounded-lg border border-slate-200">
          <span className="text-xs font-medium text-slate-700">Formato de papel térmico:</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPaperWidth('80mm')}
              className={`px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                paperWidth === '80mm'
                  ? 'bg-[#1A5F7A] text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-200'
              }`}
            >
              80 mm (Estándar)
            </button>
            <button
              type="button"
              onClick={() => setPaperWidth('58mm')}
              className={`px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                paperWidth === '58mm'
                  ? 'bg-[#1A5F7A] text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-200'
              }`}
            >
              58 mm (Compacto)
            </button>
          </div>
        </div>

        {/* Vista previa simulada de boleto térmico */}
        <div className="flex justify-center bg-slate-200/80 p-4 rounded-xl">
          <div
            className={`bg-white text-slate-900 shadow-md font-mono transition-all duration-200 ${
              paperWidth === '58mm' ? 'w-[220px] text-[10px] p-2.5' : 'w-[300px] text-[11px] p-4'
            }`}
          >
            {/* Encabezado */}
            <div className="text-center border-b border-dashed border-slate-800 pb-2 mb-3 space-y-0.5">
              <h4 className="font-bold uppercase tracking-wider text-slate-900 text-xs">
                COMPROBANTE DE DESPACHO
              </h4>
              <p className="text-[10px] text-slate-600">Control Comercial de Inventario</p>
            </div>

            {/* Metadatos */}
            <div className="space-y-1 mb-3 text-slate-800">
              <div className="flex justify-between">
                <span>Folio:</span>
                <strong className="font-bold">{formatSaleDisplayLabel(sale)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Fecha:</span>
                <span>{formatDateTime(sale.dispatchedAt || sale.closedAt || sale.openedAt)}</span>
              </div>
              {(sale.accountName || sale.customerOrTableLabel) && (
                <div className="flex justify-between">
                  <span>Cuenta/Ref:</span>
                  <span className="font-semibold">{sale.accountName || sale.customerOrTableLabel}</span>
                </div>
              )}
            </div>

            {/* Tabla de partidas */}
            <table className="w-full border-collapse mb-3 text-left">
              <thead>
                <tr className="border-b border-dashed border-slate-800 text-[10px] text-slate-700">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">Cant</th>
                  <th className="py-1 text-right">P.U.</th>
                  <th className="py-1 text-right">Subt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(sale.items || []).map((item) => (
                  <tr key={item.productId}>
                    <td className="py-1 font-sans font-medium pr-1 text-slate-900 break-words">
                      {item.productName}
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {item.quantity} {item.unitSymbol || 'pza'}
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {formatCurrency(item.unitSalePrice)}
                    </td>
                    <td className="py-1 text-right font-bold whitespace-nowrap">
                      {formatCurrency(item.lineSubtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Total */}
            <div className="border-t border-b border-dashed border-slate-800 py-2 my-2 flex justify-between items-center text-xs font-bold">
              <span>TOTAL DESPACHADO:</span>
              <span className="text-sm">{formatCurrency(sale.totalAmount || 0)}</span>
            </div>

            {/* Pie del comprobante */}
            <div className="text-center text-[9px] text-slate-500 italic mt-3 pt-2 border-t border-slate-200">
              *** COMPROBANTE DE DESPACHO DE MERCANCÍA ***
              <br />
              Este documento respalda la entrega física de productos.
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
