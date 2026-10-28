import React from 'react';

export interface FormFieldProps {
  readonly id: string;
  readonly label: string;
  readonly helperText?: string;
  readonly errorText?: string;
  readonly children: React.ReactNode;
}

export function FormField({
  id,
  label,
  helperText,
  errorText,
  children,
}: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-[#123F55]">
        {label}
      </label>
      {children}
      {errorText ? (
        <p className="text-xs text-red-600">{errorText}</p>
      ) : helperText ? (
        <p className="text-xs text-slate-500">{helperText}</p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  readonly leadingIcon?: React.ReactNode;
}

export function TextInput({
  leadingIcon,
  className = '',
  ...rest
}: TextInputProps) {
  return (
    <div className="relative flex items-center">
      {leadingIcon && (
        <span className="pointer-events-none absolute left-3 text-slate-400">
          {leadingIcon}
        </span>
      )}
      <input
        className={[
          'h-10 w-full rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400',
          'transition-colors duration-150 hover:border-slate-400',
          'focus:border-[#1A5F7A] focus:outline-none focus:ring-2 focus:ring-[#1A5F7A]/20',
          'disabled:bg-slate-100 disabled:text-slate-500',
          leadingIcon ? 'pl-9 pr-3.5' : 'px-3.5',
          className,
        ].join(' ')}
        {...rest}
      />
    </div>
  );
}

export interface SelectInputProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  readonly children: React.ReactNode;
}

export function SelectInput({
  className = '',
  children,
  ...rest
}: SelectInputProps) {
  return (
    <select
      className={[
        'h-10 w-full rounded-lg border border-slate-300 bg-white text-sm text-slate-900',
        'transition-colors duration-150 hover:border-slate-400',
        'focus:border-[#1A5F7A] focus:outline-none focus:ring-2 focus:ring-[#1A5F7A]/20',
        'disabled:bg-slate-100 disabled:text-slate-500 px-3.5',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </select>
  );
}

