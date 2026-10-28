import { useCallback, useEffect, useState } from 'react';
import { DomainError } from '../types/errors';

export interface AsyncQueryState<T> {
  readonly data: T | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly isUnauthorized: boolean;
  readonly reload: () => Promise<void>;
}

export function useAsyncQuery<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[]
): AsyncQueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState<boolean>(false);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setIsUnauthorized(false);

    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'UNAUTHORIZED_OPERATION') {
        setIsUnauthorized(true);
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Ocurrió un error inesperado al consultar la información local.');
      }
      setData(null);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void execute();
  }, [execute]);

  return {
    data,
    isLoading,
    error,
    isUnauthorized,
    reload: execute,
  };
}
