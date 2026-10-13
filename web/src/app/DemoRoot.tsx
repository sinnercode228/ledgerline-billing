import { useEffect, useState } from 'react';
import { ApiProvider } from '../api/api-context';
import type { DemoApi } from '../demo/demo-api';
import type { KeyValueStorage } from '../demo/persistence';
import { App } from './App';
import { BootScreen } from './BootScreen';

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let booting: Promise<DemoApi> | null = null;

/** Starts the engine in the page once, even when React mounts twice in development. */
function bootDemo(onProgress: (day: number, days: number) => void): Promise<DemoApi> {
  booting ??= import('../demo/demo-api').then(({ createDemoApi }) => createDemoApi({ today: new Date(), storage: browserStorage(), onProgress }));
  return booting;
}

export function DemoRoot() {
  const [api, setApi] = useState<DemoApi | null>(null);
  const [progress, setProgress] = useState({ day: 0, days: 1 });
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    bootDemo((day, days) => setProgress({ day, days })).then(setApi, (error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
  }, []);

  if (!api) return <BootScreen day={progress.day} days={progress.days} failure={failure} />;
  return (
    <ApiProvider api={api}>
      <App
        connection={{
          kind: 'demo',
          saveFailed: api.saveFailed,
          reset: () => {
            api.reset();
            window.location.reload();
          },
        }}
      />
    </ApiProvider>
  );
}
