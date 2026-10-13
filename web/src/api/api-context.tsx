import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react';
import type { LedgerlineApi } from './client';

interface ApiState {
  api: LedgerlineApi;
  /** Bumped after every change, so whatever is on screen loads again. */
  revision: number;
  refresh: () => void;
}

const ApiContext = createContext<ApiState | null>(null);

export function ApiProvider({ api, children }: { api: LedgerlineApi; children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const state = useMemo(() => ({ api, revision, refresh }), [api, revision, refresh]);
  return <ApiContext.Provider value={state}>{children}</ApiContext.Provider>;
}

function useApiState(): ApiState {
  const state = useContext(ApiContext);
  if (!state) throw new Error('this component needs an ApiProvider');
  return state;
}

export const useApi = (): LedgerlineApi => useApiState().api;

/** Changes after every refresh, for components that read state outside a resource. */
export const useRevision = (): number => useApiState().revision;

/** Call after a change so every loaded resource fetches again. */
export const useRefresh = (): (() => void) => useApiState().refresh;

export interface Resource<T> {
  data: T | undefined;
  error: Error | null;
  /** True while a load is in flight; earlier data for the same key stays visible meanwhile. */
  loading: boolean;
  reload: () => void;
}

interface Settled<T> {
  key: string;
  request: string;
  data: T | undefined;
  error: Error | null;
}

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/**
 * Loads data for `key` and loads it again after every refresh. While a new
 * load runs, the last data for the same key stays on screen, so tables keep
 * their frame instead of flashing a spinner.
 */
export function useResource<T>(key: string, load: (api: LedgerlineApi) => Promise<T>): Resource<T> {
  const { api, revision } = useApiState();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const request = `${key}#${revision}#${attempt}`;
  const run = useEffectEvent(() => load(api));

  useEffect(() => {
    let current = true;
    run().then(
      (data) => {
        if (current) setSettled({ key, request, data, error: null });
      },
      (error: unknown) => {
        if (current) setSettled((previous) => ({ key, request, data: previous?.key === key ? previous.data : undefined, error: asError(error) }));
      },
    );
    return () => {
      current = false;
    };
  }, [key, request]);

  const sameKey = settled?.key === key;
  return {
    data: sameKey ? settled.data : undefined,
    error: sameKey ? settled.error : null,
    loading: settled?.request !== request,
    reload: () => setAttempt((current) => current + 1),
  };
}
