import {
  KardexMovementEntry,
  PriceChangeRecord,
  ProductHistorySummary,
  ProductStatusChangeRecord,
  UnifiedHistoryEvent,
} from '../../domain/entities/ProductHistoryRecords';
import { MerchandiseEntryRecord } from '../../domain/entities/MerchandiseEntryRecord';

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

function triggerDownload(filename: string, csvContent: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 30);
}

export function buildUnifiedActivityCsv(
  product: ProductHistorySummary,
  events: readonly UnifiedHistoryEvent[],
  canViewCosts: boolean
): string {
  const headers = [
    'Fecha y Hora (Real)',
    'Fecha Declarada',
    'Tipo de Operación',
    'Descripción',
    'Cantidad',
    'Stock Previo',
    'Stock Resultante',
    'Diferencia Stock',
    'Precio Venta ($)',
    ...(canViewCosts ? ['Costo Unitario ($)', 'Costo Total ($)'] : []),
    'Motivo / Observaciones',
    'Responsable',
  ];

  const rows = events.map((ev) => [
    ev.timestamp,
    ev.declaredDate ?? 'N/A',
    ev.title,
    ev.description,
    ev.quantity ?? 'N/A',
    ev.previousStock ?? 'N/A',
    ev.resultingStock ?? 'N/A',
    ev.stockDifference ?? 'N/A',
    ev.declaredSalePrice ?? ev.newSalePrice ?? 'N/A',
    ...(canViewCosts ? [ev.unitPurchasePrice ?? 'N/A', ev.totalCost ?? 'N/A'] : []),
    ev.reason ?? 'N/A',
    ev.responsibleUserId,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

export function exportUnifiedActivityCsv(
  product: ProductHistorySummary,
  events: readonly UnifiedHistoryEvent[],
  canViewCosts: boolean
): void {
  const csv = buildUnifiedActivityCsv(product, events, canViewCosts);
  const dateStr = new Date().toISOString().slice(0, 10);
  triggerDownload(`actividad_${sanitizeFilename(product.name)}_${dateStr}.csv`, csv);
}

export function buildMerchandiseEntriesCsv(
  product: ProductHistorySummary,
  entries: readonly MerchandiseEntryRecord[],
  canViewCosts: boolean
): string {
  const headers = [
    'ID Entrada',
    'Fecha Declarada',
    'Fecha y Hora Registro',
    'Cantidad Recibida',
    'Precio Venta Declarado ($)',
    ...(canViewCosts ? ['Costo Compra Unitario ($)', 'Costo Total Entrada ($)'] : []),
    'Responsable',
  ];

  const rows = entries.map((e) => [
    e.id,
    e.declaredEntryDate,
    e.registeredAt,
    e.quantity,
    e.declaredSalePrice.toFixed(2),
    ...(canViewCosts ? [e.unitPurchasePrice.toFixed(2), e.totalEntryCost.toFixed(2)] : []),
    e.responsibleUserId,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

export function exportMerchandiseEntriesCsv(
  product: ProductHistorySummary,
  entries: readonly MerchandiseEntryRecord[],
  canViewCosts: boolean
): void {
  const csv = buildMerchandiseEntriesCsv(product, entries, canViewCosts);
  const dateStr = new Date().toISOString().slice(0, 10);
  triggerDownload(`entradas_${sanitizeFilename(product.name)}_${dateStr}.csv`, csv);
}

export function buildKardexCsv(
  product: ProductHistorySummary,
  kardex: readonly KardexMovementEntry[]
): string {
  const headers = [
    'Fecha y Hora',
    'Tipo de Movimiento',
    'Entrada',
    'Salida',
    'Existencia Anterior',
    'Existencia Resultante',
    'Motivo / Referencia',
    'Responsable',
  ];

  const rows = kardex.map((k) => [
    k.timestamp,
    k.movementTypeLabel,
    k.entryQuantity !== null ? k.entryQuantity : '',
    k.exitQuantity !== null ? k.exitQuantity : '',
    k.previousStock,
    k.resultingStock,
    k.referenceOrReason,
    k.responsibleUserId,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

export function exportKardexCsv(
  product: ProductHistorySummary,
  kardex: readonly KardexMovementEntry[]
): void {
  const csv = buildKardexCsv(product, kardex);
  const dateStr = new Date().toISOString().slice(0, 10);
  triggerDownload(`kardex_${sanitizeFilename(product.name)}_${dateStr}.csv`, csv);
}

export function buildPriceChangesCsv(
  product: ProductHistorySummary,
  priceChanges: readonly PriceChangeRecord[]
): string {
  const headers = [
    'Fecha y Hora',
    'Precio Anterior ($)',
    'Precio Nuevo ($)',
    'Diferencia ($)',
    'Variación (%)',
    'Motivo',
    'Responsable',
  ];

  const rows = priceChanges.map((p) => {
    const diff = p.newSalePrice - p.previousSalePrice;
    const pct =
      p.previousSalePrice > 0
        ? (((p.newSalePrice - p.previousSalePrice) / p.previousSalePrice) * 100).toFixed(1) + '%'
        : 'N/A';
    return [
      p.changedAt,
      p.previousSalePrice.toFixed(2),
      p.newSalePrice.toFixed(2),
      diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
      pct,
      p.reason ?? 'Sin motivo registrado',
      p.responsibleUserId,
    ];
  });

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

export function exportPriceChangesCsv(
  product: ProductHistorySummary,
  priceChanges: readonly PriceChangeRecord[]
): void {
  const csv = buildPriceChangesCsv(product, priceChanges);
  const dateStr = new Date().toISOString().slice(0, 10);
  triggerDownload(`precios_${sanitizeFilename(product.name)}_${dateStr}.csv`, csv);
}

export function buildStatusChangesCsv(
  product: ProductHistorySummary,
  statusChanges: readonly ProductStatusChangeRecord[]
): string {
  const headers = [
    'Fecha y Hora',
    'Estado Anterior',
    'Estado Nuevo',
    'Motivo',
    'Responsable',
  ];

  const rows = statusChanges.map((s) => [
    s.changedAt,
    s.previousStatus,
    s.newStatus,
    s.reason,
    s.responsibleUserId,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

export function exportStatusChangesCsv(
  product: ProductHistorySummary,
  statusChanges: readonly ProductStatusChangeRecord[]
): void {
  const csv = buildStatusChangesCsv(product, statusChanges);
  const dateStr = new Date().toISOString().slice(0, 10);
  triggerDownload(`estados_${sanitizeFilename(product.name)}_${dateStr}.csv`, csv);
}
