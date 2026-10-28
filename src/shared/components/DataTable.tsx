import React from 'react';
import { EmptyState } from './EmptyState';

export interface TableColumn<TRow> {
  readonly key: string;
  readonly header: string;
  readonly align?: 'left' | 'right';
  readonly tabular?: boolean;
  readonly render: (row: TRow) => React.ReactNode;
}

export interface DataTableProps<TRow> {
  readonly columns: readonly TableColumn<TRow>[];
  readonly rows: readonly TRow[];
  readonly getRowKey: (row: TRow) => string;
  readonly isLoading?: boolean;
  readonly emptyIcon?: React.ReactNode;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly emptyAction?: React.ReactNode;
  readonly onRowClick?: (row: TRow) => void;
  readonly maxHeightClassName?: string;
}

export function DataTable<TRow>({
  columns,
  rows,
  getRowKey,
  isLoading = false,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  maxHeightClassName = 'max-h-[65dvh]',
}: DataTableProps<TRow>) {
  return (
    <div
      className={[
        'w-full min-w-0 overflow-x-auto overflow-y-auto',
        maxHeightClassName,
      ].join(' ')}
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-[#F8F9FA] shadow-[0_1px_0_0_#e2e8f0]">
          <tr className="border-b border-slate-200 bg-[#F8F9FA]">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={[
                  'h-10 px-4 text-xs font-semibold text-[#123F55] whitespace-nowrap bg-[#F8F9FA]',
                  col.align === 'right' ? 'text-right' : 'text-left',
                ].join(' ')}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, idx) => (
              <tr key={`skeleton-${idx}`} className="h-10">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-2.5">
                    <div className="h-3.5 w-24 rounded bg-slate-100" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState
                  icon={emptyIcon}
                  title={emptyTitle}
                  description={emptyDescription}
                  action={emptyAction}
                />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={[
                  'h-10 transition-colors duration-150 hover:bg-slate-50',
                  onRowClick ? 'cursor-pointer' : '',
                ].join(' ')}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={[
                      'px-4 py-2.5 text-sm text-slate-700',
                      col.align === 'right' ? 'text-right' : 'text-left',
                      col.tabular ? 'font-mono tabular-nums text-xs' : '',
                    ].join(' ')}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

