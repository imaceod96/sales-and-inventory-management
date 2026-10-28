import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { hasPermission, ROLE_LABELS } from '../../shared/lib/permissions/rolePolicy';
import { sessionElevationService } from '../../shared/lib/security/SessionElevationService';
import { Permission, SessionActor, UserRole } from '../../shared/types/permissions';

export interface SessionContextValue {
  readonly actor: SessionActor;
  readonly setRole: (role: UserRole) => void;
  readonly elevateToAdmin: (elevationToken: string) => void;
  readonly switchToCashier: () => void;
  readonly openAdminPinModal: () => void;
  readonly closeAdminPinModal: () => void;
  readonly isPinModalOpen: boolean;
  readonly can: (permission: Permission) => boolean;
  readonly setRoleDirectForTesting: (role: UserRole, mockToken?: string) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { readonly children: React.ReactNode }) {
  // Inicio de aplicación obligatorio en modo CASHIER (no restaura ADMIN ni elevaciones en reloads)
  const [role, setRoleState] = useState<UserRole>(UserRole.CASHIER);
  const [elevationToken, setElevationToken] = useState<string | undefined>(undefined);
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);

  useEffect(() => {
    // Al montar la aplicación, revocar elevaciones previas
    sessionElevationService.revokeAll();
  }, []);

  const actor = useMemo<SessionActor>(
    () => ({
      role,
      label: ROLE_LABELS[role],
      elevationToken,
    }),
    [role, elevationToken]
  );

  const switchToCashier = useCallback(() => {
    sessionElevationService.revokeAll();
    setElevationToken(undefined);
    setRoleState(UserRole.CASHIER);
    setIsPinModalOpen(false);
  }, []);

  const openAdminPinModal = useCallback(() => {
    setIsPinModalOpen(true);
  }, []);

  const closeAdminPinModal = useCallback(() => {
    setIsPinModalOpen(false);
  }, []);

  const elevateToAdmin = useCallback((token: string) => {
    setElevationToken(token);
    setRoleState(UserRole.ADMIN);
    setIsPinModalOpen(false);
  }, []);

  const setRole = useCallback((nextRole: UserRole) => {
    if (nextRole === UserRole.CASHIER) {
      switchToCashier();
    } else {
      openAdminPinModal();
    }
  }, [switchToCashier, openAdminPinModal]);

  const setRoleDirectForTesting = useCallback((nextRole: UserRole, mockToken?: string) => {
    if (nextRole === UserRole.ADMIN) {
      const token = mockToken || sessionElevationService.registerElevatedSession('Administrador Pruebas');
      setElevationToken(token);
      setRoleState(UserRole.ADMIN);
    } else {
      switchToCashier();
    }
  }, [switchToCashier]);

  const can = useCallback(
    (permission: Permission) => hasPermission(role, permission),
    [role]
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      actor,
      setRole,
      elevateToAdmin,
      switchToCashier,
      openAdminPinModal,
      closeAdminPinModal,
      isPinModalOpen,
      can,
      setRoleDirectForTesting,
    }),
    [actor, setRole, elevateToAdmin, switchToCashier, openAdminPinModal, closeAdminPinModal, isPinModalOpen, can, setRoleDirectForTesting]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession debe utilizarse dentro de SessionProvider.');
  }
  return ctx;
}
