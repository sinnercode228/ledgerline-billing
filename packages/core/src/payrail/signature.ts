/**
 * Payrail signs webhooks with `Payrail-Signature: t=<unix>,v1=<hex>[,v1=<hex>]`
 * where each v1 is HMAC-SHA256 over "<t>.<raw body>". Several v1 values let
 * the sender sign with old and new secrets while a secret is being rotated.
 * Web Crypto keeps this usable in the browser as well as in Node.
 */
export const SIGNATURE_HEADER = 'payrail-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureFailure = 'missing_header' | 'malformed_header' | 'timestamp_out_of_tolerance' | 'no_matching_signature';
export type SignatureVerification = { ok: true; timestamp: number } | { ok: false; reason: SignatureFailure };

const encoder = new TextEncoder();

function signedBytes(timestamp: number, payload: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = encoder.encode(`${timestamp}.`);
  const body = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const bytes = new Uint8Array(prefix.length + body.length);
  bytes.set(prefix, 0);
  bytes.set(body, prefix.length);
  return bytes;
}

async function hmacSha256Hex(secret: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function computeSignature(secret: string, timestamp: number, payload: string | Uint8Array): Promise<string> {
  return hmacSha256Hex(secret, signedBytes(timestamp, payload));
}

export async function signPayload(payload: string | Uint8Array, secret: string, timestamp: number): Promise<string> {
  return `t=${timestamp},v1=${await computeSignature(secret, timestamp, payload)}`;
}

/** Constant time for equal-length inputs; lengths are public (always 64 for SHA-256). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) return null;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') {
      if (!/^\d{1,12}$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === 'v1') {
      if (!/^[0-9a-f]+$/i.test(value)) return null;
      signatures.push(value.toLowerCase());
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export async function verifySignature(input: {
  header: string | undefined;
  payload: string | Uint8Array;
  secrets: readonly string[];
  now: Date;
  toleranceSeconds?: number;
}): Promise<SignatureVerification> {
  if (input.header === undefined) return { ok: false, reason: 'missing_header' };
  const parsed = parseHeader(input.header);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  let matched = false;
  for (const secret of input.secrets) {
    const expected = await computeSignature(secret, parsed.timestamp, input.payload);
    for (const candidate of parsed.signatures) {
      matched = timingSafeEqualHex(expected, candidate) || matched;
    }
  }
  return matched ? { ok: true, timestamp: parsed.timestamp } : { ok: false, reason: 'no_matching_signature' };
}
