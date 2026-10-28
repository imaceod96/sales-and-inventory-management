export type PaperWidth = '80mm' | '58mm';

export interface PrintOptions {
  readonly paperWidth?: PaperWidth;
  readonly documentTitle?: string;
}

export interface PrintResult {
  readonly success: boolean;
  readonly cancelled?: boolean;
  readonly error?: string;
}

export interface PrintableReceiptItem {
  readonly productId?: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly subtotal: number;
  readonly unitSymbol?: string;
}

export interface PrintableReceipt {
  readonly title: string;
  readonly subtitle?: string;
  readonly folio: string;
  readonly dateISO: string;
  readonly accountName?: string;
  readonly customerOrTableLabel?: string;
  readonly details?: readonly { readonly label: string; readonly value: string }[];
  readonly items: readonly PrintableReceiptItem[];
  readonly totalAmount: number;
  readonly rawText?: string;
}

export interface PrinterPort {
  printReceipt(receipt: PrintableReceipt, options?: PrintOptions): Promise<PrintResult>;
  printHtml(htmlContent: string, options?: PrintOptions): Promise<PrintResult>;
  printWindow(): Promise<PrintResult>;
}

