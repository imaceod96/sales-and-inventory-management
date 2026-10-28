import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly maxWidthClassName?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidthClassName = 'max-w-lg',
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-hidden"
    >
      <div
        className="fixed inset-0 bg-[#123F55]/45 transition-opacity duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={[
          'relative z-10 flex w-full flex-col overflow-hidden rounded-lg bg-white border border-slate-200 shadow-xl',
          'max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)]',
          maxWidthClassName,
        ].join(' ')}
      >
        {/* 1. Cabecera fija */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1">
            <h2
              id="modal-dialog-title"
              className="text-base font-semibold text-[#123F55] leading-snug"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#123F55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A5F7A] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 2. Cuerpo desplazable inteligente */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5 text-sm text-slate-700">
          {children}
        </div>

        {/* 3. Pie de acciones fijo */}
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 bg-[#F8F9FA] px-4 py-3 sm:px-6 sm:py-3.5 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

