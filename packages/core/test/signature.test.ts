import { describe, expect, it } from 'vitest';
import { signPayload, timingSafeEqualHex, verifySignature } from '../src/payrail/signature.js';

const secret = 'whsec_test_0f6c2b9e4d';
const rotated = 'whsec_test_new_71aa03';
const now = new Date('2026-06-01T12:00:00Z');
const t = Math.floor(now.getTime() / 1000);
const body = '{"id":"evt_1","type":"payment.succeeded"}';

describe('Payrail webhook signatures', () => {
  it('accepts a payload signed with the current secret', async () => {
    const header = await signPayload(body, secret, t);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    await expect(verifySignature({ header, payload: body, secrets: [secret], now })).resolves.toEqual({ ok: true, timestamp: t });
  });

  it('rejects a tampered payload or a wrong secret', async () => {
    const header = await signPayload(body, secret, t);
    await expect(verifySignature({ header, payload: body.replace('evt_1', 'evt_2'), secrets: [secret], now })).resolves.toEqual({
      ok: false,
      reason: 'no_matching_signature',
    });
    await expect(verifySignature({ header, payload: body, secrets: ['whsec_other'], now })).resolves.toMatchObject({ ok: false });
  });

  it('enforces the 300 second tolerance in both directions', async () => {
    const old = await signPayload(body, secret, t - 301);
    const edge = await signPayload(body, secret, t - 300);
    const future = await signPayload(body, secret, t + 301);
    await expect(verifySignature({ header: old, payload: body, secrets: [secret], now })).resolves.toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
    await expect(verifySignature({ header: edge, payload: body, secrets: [secret], now })).resolves.toMatchObject({ ok: true });
    await expect(verifySignature({ header: future, payload: body, secrets: [secret], now })).resolves.toMatchObject({ ok: false });
  });

  it('supports secret rotation with several v1 values and several secrets', async () => {
    const oldHeader = await signPayload(body, secret, t);
    const newHeader = await signPayload(body, rotated, t);
    const both = `${oldHeader},v1=${newHeader.split('v1=')[1]!}`;
    await expect(verifySignature({ header: both, payload: body, secrets: [rotated], now })).resolves.toMatchObject({ ok: true });
    await expect(verifySignature({ header: oldHeader, payload: body, secrets: [rotated, secret], now })).resolves.toMatchObject({ ok: true });
    await expect(verifySignature({ header: oldHeader, payload: body, secrets: [rotated], now })).resolves.toMatchObject({ ok: false });
  });

  it('signs the raw bytes, so whitespace matters', async () => {
    const raw = '{ "id" : "evt_1",\n  "type": "payment.succeeded" }\n';
    const header = await signPayload(raw, secret, t);
    await expect(verifySignature({ header, payload: new TextEncoder().encode(raw), secrets: [secret], now })).resolves.toMatchObject({ ok: true });
    const reserialized = JSON.stringify(JSON.parse(raw));
    await expect(verifySignature({ header, payload: reserialized, secrets: [secret], now })).resolves.toMatchObject({ ok: false });
  });

  it('reports missing and malformed headers', async () => {
    await expect(verifySignature({ header: undefined, payload: body, secrets: [secret], now })).resolves.toEqual({ ok: false, reason: 'missing_header' });
    for (const header of ['v1=abc', 't=abc,v1=00', `t=${t}`, `t=${t},v1=xyz`, '']) {
      await expect(verifySignature({ header, payload: body, secrets: [secret], now })).resolves.toMatchObject({ ok: false });
    }
  });

  it('compares hex digests without short-circuiting on content', () => {
    expect(timingSafeEqualHex('00ff', '00ff')).toBe(true);
    expect(timingSafeEqualHex('00ff', '00fe')).toBe(false);
    expect(timingSafeEqualHex('00ff', '00ff00')).toBe(false);
  });
});
