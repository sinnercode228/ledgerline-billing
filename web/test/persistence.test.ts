import { describe, expect, it } from 'vitest';
import { decode, encode, loadWorld, saveWorld, type KeyValueStorage } from '../src/demo/persistence';

function storage(overrides: Partial<KeyValueStorage> = {}): KeyValueStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    ...overrides,
  };
}

describe('demo persistence', () => {
  it('brings Dates back as Dates, wherever they sit', () => {
    const value = { at: new Date('2026-10-13T09:00:00Z'), rows: [{ paidAt: new Date('2026-10-14T09:00:00Z'), note: null }], label: '2026-10-13' };
    const decoded = decode(encode(value)) as typeof value;
    expect(decoded).toEqual(value);
    expect(decoded.rows[0]!.paidAt).toBeInstanceOf(Date);
    expect(typeof decoded.label).toBe('string');
  });

  it('ignores a save from another version or one it cannot read', () => {
    const store = storage();
    store.items.set('ledgerline.demo-world', encode({ version: 0, random: 1, dump: {} }));
    expect(loadWorld(store)).toBeNull();
    store.items.set('ledgerline.demo-world', '{not json');
    expect(loadWorld(store)).toBeNull();
  });

  it('reports a refused write instead of throwing', () => {
    const full = storage({
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      },
    });
    expect(saveWorld(full, { random: 1, dump: { clock: null } as never })).toBe(false);
  });
});
