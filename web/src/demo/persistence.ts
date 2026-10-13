import type { MemoryStoreDump } from '@ledgerline/core';

/** What the demo keeps in localStorage between visits. */
export interface SavedWorld {
  version: typeof SAVE_VERSION;
  /** State of the seeded random source, so ids keep coming from the same sequence. */
  random: number;
  dump: MemoryStoreDump;
}

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const SAVE_VERSION = 1;
const STORAGE_KEY = 'ledgerline.demo-world';
const DATE_TAG = '$date';

/** JSON that brings Dates back as Dates. */
export function encode(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, item: unknown) {
    // `item` has already been through Date#toJSON; the holder still has the Date.
    const original = this[key];
    return original instanceof Date ? { [DATE_TAG]: original.toISOString() } : item;
  });
}

export function decode(text: string): unknown {
  return JSON.parse(text, (_key, item: unknown) => {
    if (typeof item === 'object' && item !== null && Object.keys(item).length === 1 && DATE_TAG in item) {
      return new Date((item as Record<typeof DATE_TAG, string>)[DATE_TAG]);
    }
    return item;
  });
}

export function loadWorld(storage: KeyValueStorage | null): SavedWorld | null {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    if (!text) return null;
    const saved = decode(text) as Partial<SavedWorld>;
    return saved.version === SAVE_VERSION && saved.dump && typeof saved.random === 'number' ? (saved as SavedWorld) : null;
  } catch {
    // An unreadable save is not worth an error page: the world is rebuilt.
    return null;
  }
}

/** Returns false when the browser refused the write, for example over quota. */
export function saveWorld(storage: KeyValueStorage | null, world: Omit<SavedWorld, 'version'>): boolean {
  if (!storage) return true;
  try {
    storage.setItem(STORAGE_KEY, encode({ version: SAVE_VERSION, ...world }));
    return true;
  } catch {
    return false;
  }
}

export function forgetWorld(storage: KeyValueStorage | null): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to forget when storage is unavailable.
  }
}
