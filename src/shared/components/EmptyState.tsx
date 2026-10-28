import React from 'react';

export interface EmptyStateProps {
  readonly icon?: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly action?: React.ReactNode;
  readonly compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-12 px-6',
      ].join(' ')}
    >
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[#F8F9FA] border border-slate-200 text-[#287C99]">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-[#123F55]">{title}</h3>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
