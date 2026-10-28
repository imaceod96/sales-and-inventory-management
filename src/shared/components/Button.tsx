import React from 'react';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[#1A5F7A] text-white hover:bg-[#123F55] active:bg-[#123F55] border border-transparent',
  accent:
    'bg-[#F49D37] text-[#123F55] hover:bg-[#e58d26] active:bg-[#d67e19] border border-transparent font-semibold',
  secondary:
    'bg-white text-[#123F55] border border-slate-300 hover:bg-slate-50 hover:border-[#287C99]/50 active:bg-slate-100',
  ghost:
    'bg-transparent text-slate-700 border border-transparent hover:bg-slate-100 hover:text-[#123F55]',
  danger:
    'bg-red-600 text-white border border-transparent hover:bg-red-700 active:bg-red-800',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2.5',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150',
        'whitespace-nowrap shrink-0 cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A5F7A] focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}
