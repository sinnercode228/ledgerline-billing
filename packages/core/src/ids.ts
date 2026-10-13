export type IdGenerator = (prefix: string) => string;

const ID_BYTES = 12;

function format(prefix: string, bytes: Uint8Array): string {
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function newId(prefix: string): string {
  return format(prefix, crypto.getRandomValues(new Uint8Array(ID_BYTES)));
}

/** Ids drawn from `random` instead of the system generator, for worlds that must be rebuilt exactly. */
export function seededIds(random: () => number): IdGenerator {
  return (prefix) => format(prefix, Uint8Array.from({ length: ID_BYTES }, () => Math.floor(random() * 256)));
}
