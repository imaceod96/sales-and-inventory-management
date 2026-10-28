import React from 'react';

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4 pb-4 sm:pb-6">
      <div className="min-w-0 flex-1 max-w-2xl">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#123F55]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-xs sm:text-sm text-slate-600">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">{actions}</div>
      )}
    </div>
  );
}

