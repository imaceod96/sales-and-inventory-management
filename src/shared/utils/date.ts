import { ISODateString } from '../types/entity';

const dateTimeFormatter = new Intl.DateTimeFormat('es-MX', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateOnlyFormatter = new Intl.DateTimeFormat('es-MX', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function nowISO(): ISODateString {
  return new Date().toISOString();
}

export function formatDateTime(iso: ISODateString | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return dateTimeFormatter.format(parsed);
}

export function formatCurrentLocalDate(): string {
  return dateOnlyFormatter.format(new Date());
}

export function getTodayLocalDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isFutureDate(dateStr: string): boolean {
  const today = getTodayLocalDateString();
  return dateStr > today;
}

export function isSameLocalDay(isoA: ISODateString, isoB: ISODateString): boolean {
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
