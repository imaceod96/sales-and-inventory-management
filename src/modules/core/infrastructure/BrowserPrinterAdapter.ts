import {
  PaperWidth,
  PrintableReceipt,
  PrinterPort,
  PrintOptions,
  PrintResult,
} from '../domain/ports/PrinterPort';

export class BrowserPrinterAdapter implements PrinterPort {
  public async printReceipt(
    receipt: PrintableReceipt,
    options?: PrintOptions
  ): Promise<PrintResult> {
    const paperWidth = options?.paperWidth ?? '80mm';
    const htmlContent = this.formatReceiptHtml(receipt, paperWidth);
    return this.printHtml(htmlContent, {
      paperWidth,
      documentTitle: `${receipt.title} - ${receipt.folio}`,
    });
  }

  public async printHtml(
    htmlContent: string,
    options?: PrintOptions
  ): Promise<PrintResult> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { success: true };
    }

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';

      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) {
        document.body.removeChild(iframe);
        return { success: false, error: 'No se pudo acceder al documento de impresión.' };
      }

      doc.open();
      doc.write(htmlContent);
      doc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // Si el usuario cancela o el navegador bloquea
        } finally {
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
          }, 1000);
        }
      }, 250);

      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Error al intentar imprimir el comprobante.',
      };
    }
  }

  public async printWindow(): Promise<PrintResult> {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      try {
        window.print();
        return { success: true };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error al invocar impresión del navegador.',
        };
      }
    }
    return { success: true };
  }

  public formatReceiptHtml(receipt: PrintableReceipt, paperWidth: PaperWidth = '80mm'): string {
    const is58 = paperWidth === '58mm';
    const maxWidth = is58 ? '54mm' : '76mm';
    const fontSize = is58 ? '10px' : '11px';

    const itemsRows = receipt.items
      .map(
        (item) => `
        <tr>
          <td style="padding: 2px 0; font-weight: bold; word-break: break-word;">${item.productName}</td>
          <td style="padding: 2px 0; text-align: right; white-space: nowrap;">${item.quantity} ${item.unitSymbol || 'pza'}</td>
          <td style="padding: 2px 0; text-align: right; white-space: nowrap;">$${item.unitPrice.toFixed(2)}</td>
          <td style="padding: 2px 0; text-align: right; font-weight: bold; white-space: nowrap;">$${item.subtotal.toFixed(2)}</td>
        </tr>`
      )
      .join('');

    const accountLine = receipt.accountName || receipt.customerOrTableLabel
      ? `<div style="margin-bottom: 4px;"><strong>Cuenta / Ref:</strong> ${receipt.accountName || receipt.customerOrTableLabel}</div>`
      : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${receipt.title} - ${receipt.folio}</title>
        <style>
          @page {
            margin: 0;
            size: ${paperWidth} auto;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: ${fontSize};
            line-height: 1.3;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 4px;
            max-width: ${maxWidth};
          }
          .header {
            text-align: center;
            margin-bottom: 8px;
            border-bottom: 1px dashed #000;
            padding-bottom: 6px;
          }
          .header h1 {
            font-size: ${is58 ? '12px' : '14px'};
            font-weight: bold;
            margin: 0 0 2px 0;
            text-transform: uppercase;
          }
          .header h2 {
            font-size: ${is58 ? '10px' : '11px'};
            font-weight: normal;
            margin: 0;
          }
          .meta {
            margin-bottom: 8px;
            font-size: ${fontSize};
          }
          .meta div {
            margin-bottom: 2px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 8px;
            font-size: ${fontSize};
          }
          th {
            border-bottom: 1px dashed #000;
            text-align: left;
            padding-bottom: 2px;
            font-size: 9px;
            text-transform: uppercase;
          }
          .total-box {
            border-top: 1px dashed #000;
            border-bottom: 1px dashed #000;
            padding: 6px 0;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            font-size: ${is58 ? '11px' : '13px'};
            font-weight: bold;
          }
          .footer {
            text-align: center;
            font-size: 9px;
            font-style: italic;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${receipt.title}</h1>
          ${receipt.subtitle ? `<h2>${receipt.subtitle}</h2>` : ''}
        </div>

        <div class="meta">
          <div><strong>Folio:</strong> ${receipt.folio}</div>
          <div><strong>Fecha:</strong> ${new Date(receipt.dateISO).toLocaleString('es-MX')}</div>
          ${accountLine}
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 40%;">Item</th>
              <th style="width: 15%; text-align: right;">Cant</th>
              <th style="width: 20%; text-align: right;">P.U.</th>
              <th style="width: 25%; text-align: right;">Subt</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        <div class="total-box">
          <span>TOTAL DESPACHADO:</span>
          <span>$${receipt.totalAmount.toFixed(2)}</span>
        </div>

        <div class="footer">
          *** COMPROBANTE DE DESPACHO DE MERCANCÍA ***<br>
          Este documento respalda la entrega física de productos.
        </div>
      </body>
      </html>
    `;
  }
}

