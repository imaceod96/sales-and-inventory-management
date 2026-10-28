import React from 'react';

export interface CardProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <section
      className={[
        'min-w-0 bg-white border border-slate-200 rounded-lg',
        className,
      ].join(' ')}
    >
      {children}
    </section>
  );
}

export interface CardHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
}

export function CardHeader({ title, description, action }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-200">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-[#123F55]">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0 flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export interface CardBodyProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function CardBody({ children, className = '' }: CardBodyProps) {
  return <div className={['p-4 sm:p-6 min-w-0', className].join(' ')}>{children}</div>;
}

