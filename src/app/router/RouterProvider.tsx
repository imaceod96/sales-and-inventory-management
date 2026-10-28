import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MatchedRoute, normalizeHashPath, resolveRoute, ROUTES } from './routes';

export type NavigationGuardFn = (nextPath: string, proceed: () => void) => boolean;

export interface RouterContextValue {
  readonly currentPath: string;
  readonly route: MatchedRoute;
  readonly navigate: (path: string) => void;
  readonly isNewSaleModalOpen: boolean;
  readonly newSaleTriggerCount: number;
  readonly openNewSaleModal: () => void;
  readonly closeNewSaleModal: () => void;
  readonly setNavigationGuard: (guard: NavigationGuardFn | null) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export function RouterProvider({ children }: { readonly children: React.ReactNode }) {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    typeof window !== 'undefined' ? normalizeHashPath(window.location.hash) : '/'
  );
  const [isNewSaleModalOpen, setIsNewSaleModalOpen] = useState<boolean>(false);
  const [newSaleTriggerCount, setNewSaleTriggerCount] = useState<number>(0);
  const navigationGuardRef = useRef<NavigationGuardFn | null>(null);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPath(normalizeHashPath(window.location.hash));
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const performNavigate = useCallback((nextPath: string) => {
    const normalized = normalizeHashPath(nextPath);
    const nextHash = `#${normalized}`;
    if (typeof window !== 'undefined' && window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    } else {
      setCurrentPath(normalized);
    }
  }, []);

  const navigate = useCallback(
    (nextPath: string) => {
      const normalized = normalizeHashPath(nextPath);
      const guard = navigationGuardRef.current;
      if (guard) {
        const shouldProceedImmediately = guard(normalized, () => {
          performNavigate(normalized);
        });
        if (!shouldProceedImmediately) {
          return;
        }
      }
      performNavigate(normalized);
    },
    [performNavigate]
  );

  const openNewSaleModal = useCallback(() => {
    const targetPath = `${ROUTES.openSales}?mode=new`;
    const guard = navigationGuardRef.current;
    if (guard) {
      const shouldProceed = guard(ROUTES.openSales, () => {
        setNewSaleTriggerCount((prev) => prev + 1);
        performNavigate(ROUTES.openSales);
      });
      if (!shouldProceed) {
        return;
      }
    }
    setNewSaleTriggerCount((prev) => prev + 1);
    performNavigate(ROUTES.openSales);
    void targetPath;
  }, [performNavigate]);

  const closeNewSaleModal = useCallback(() => {
    setIsNewSaleModalOpen(false);
  }, []);

  const setNavigationGuard = useCallback((guard: NavigationGuardFn | null) => {
    navigationGuardRef.current = guard;
  }, []);

  const route = useMemo(() => resolveRoute(currentPath), [currentPath]);

  const value = useMemo<RouterContextValue>(
    () => ({
      currentPath,
      route,
      navigate,
      isNewSaleModalOpen,
      newSaleTriggerCount,
      openNewSaleModal,
      closeNewSaleModal,
      setNavigationGuard,
    }),
    [
      currentPath,
      route,
      navigate,
      isNewSaleModalOpen,
      newSaleTriggerCount,
      openNewSaleModal,
      closeNewSaleModal,
      setNavigationGuard,
    ]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter debe utilizarse dentro de RouterProvider.');
  }
  return ctx;
}
