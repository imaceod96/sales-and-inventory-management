import React, { useEffect, useState } from 'react';
import { KeyRound, Lock, ShieldAlert, X } from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { UserRole } from '../../../../shared/types/permissions';

export function AdminPinModal() {
  const { isPinModalOpen, closeAdminPinModal, elevateToAdmin, actor } = useSession();
  const { useCases, notifyDataChanged } = useApplication();

  const [isConfigured, setIsConfigured] = useState<boolean>(true);
  const [isLockedOut, setIsLockedOut] = useState<boolean>(false);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);

  const [pin, setPin] = useState<string>('');
  const [confirmPin, setConfirmPin] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);

  useEffect(() => {
    if (!isPinModalOpen) {
      setPin('');
      setConfirmPin('');
      setErrorMessage(null);
      setIsSubmitting(false);
      return;
    }

    let isMounted = true;
    setIsLoadingStatus(true);
    setErrorMessage(null);

    useCases.core.checkAdminPinStatus
      .execute()
      .then((res) => {
        if (!isMounted) return;
        setIsConfigured(res.isConfigured);
        setIsLockedOut(res.isLockedOut);
        setLockoutSeconds(res.remainingLockoutSeconds);
        setIsLoadingStatus(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setIsLoadingStatus(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isPinModalOpen, useCases]);

  // Temporizador de conteo regresivo de bloqueo
  useEffect(() => {
    if (!isLockedOut || lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          setIsLockedOut(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isLockedOut, lockoutSeconds]);

  if (!isPinModalOpen) return null;

  const handlePinChange = (val: string, setter: (v: string) => void) => {
    const numeric = val.replace(/\D/g, '').slice(0, 6);
    setter(numeric);
    if (errorMessage) setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (pin.length !== 6) {
      setErrorMessage('El PIN debe constar exactamente de 6 dígitos numéricos.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (!isConfigured) {
        if (confirmPin.length !== 6) {
          setErrorMessage('La confirmación del PIN debe constar de 6 dígitos numéricos.');
          setIsSubmitting(false);
          return;
        }
        const res = await useCases.core.setupInitialAdminPin.execute(actor, {
          pin,
          confirmPin,
        });
        if (res.elevationToken) {
          elevateToAdmin(res.elevationToken);
        }
        notifyDataChanged();
        closeAdminPinModal();
      } else {
        const res = await useCases.core.verifyAdminPin.execute(actor, { pin });
        if (res.elevationToken) {
          elevateToAdmin(res.elevationToken);
        }
        notifyDataChanged();
        closeAdminPinModal();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al validar el PIN.');
      // Re-consultar estado de bloqueo si aplica
      const statusRes = await useCases.core.checkAdminPinStatus.execute();
      setIsLockedOut(statusRes.isLockedOut);
      setLockoutSeconds(statusRes.remainingLockoutSeconds);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl transition-all border border-slate-100">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#123F55]/10 text-[#123F55]">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {!isConfigured ? 'Configurar PIN de Administrador' : 'Acceso Administrativo'}
              </h2>
              <p className="text-xs text-slate-500">
                {!isConfigured
                  ? 'Establece un PIN de 6 dígitos para proteger funciones administrativas'
                  : 'Ingresa el PIN de 6 dígitos para elevar privilegios de sesión'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeAdminPinModal}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoadingStatus ? (
          <div className="flex h-36 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-[#123F55]" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {errorMessage && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <ShieldAlert className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                <div className="leading-snug">{errorMessage}</div>
              </div>
            )}

            {isLockedOut && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <Lock className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <strong className="font-semibold">Acceso bloqueado temporalmente.</strong>
                  <p className="mt-0.5">
                    Inténtalo de nuevo en <span className="font-mono font-bold text-amber-900">{lockoutSeconds}s</span>.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="admin-pin-input" className="block text-xs font-semibold text-slate-700 mb-1">
                {!isConfigured ? 'Nuevo PIN (6 dígitos numéricos)' : 'PIN de 6 dígitos'}
              </label>
              <input
                id="admin-pin-input"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                disabled={isLockedOut || isSubmitting}
                value={pin}
                onChange={(e) => handlePinChange(e.target.value, setPin)}
                placeholder="••••••"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-lg font-mono tracking-widest text-slate-900 shadow-xs focus:border-[#123F55] focus:outline-none focus:ring-1 focus:ring-[#123F55] disabled:bg-slate-100"
              />
            </div>

            {!isConfigured && (
              <div>
                <label htmlFor="admin-confirm-pin-input" className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirmar Nuevo PIN (6 dígitos)
                </label>
                <input
                  id="admin-confirm-pin-input"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  disabled={isLockedOut || isSubmitting}
                  value={confirmPin}
                  onChange={(e) => handlePinChange(e.target.value, setConfirmPin)}
                  placeholder="••••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-lg font-mono tracking-widest text-slate-900 shadow-xs focus:border-[#123F55] focus:outline-none focus:ring-1 focus:ring-[#123F55] disabled:bg-slate-100"
                />
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="secondary"
                onClick={closeAdminPinModal}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isLockedOut || isSubmitting || pin.length !== 6 || (!isConfigured && confirmPin.length !== 6)}
              >
                {isSubmitting
                  ? 'Verificando...'
                  : !isConfigured
                  ? 'Establecer y Acceder'
                  : 'Acceder como Administrador'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
