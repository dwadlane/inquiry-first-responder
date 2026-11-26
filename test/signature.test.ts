import { describe, expect, it } from 'vitest';
import { sign, verifySignature } from '../src/server/signature.js';

const secret = 'test-only-value';
const body = JSON.stringify({ event: 'message_created', id: 1 });
const ts = '1793931249';

describe('verifySignature', () => {
  it('accepts a correctly signed body', () => {
    expect(verifySignature({ rawBody: body, signature: sign(secret, ts, body), timestamp: ts, secret, now: 1793931250 })).toEqual({ ok: true });
  });
  it('rejects a changed body', () => {
    const r = verifySignature({ rawBody: body + ' ', signature: sign(secret, ts, body), timestamp: ts, secret, now: 1793931250 });
    expect(r.ok).toBe(false);
  });
  it('rejects the wrong secret, missing headers and old timestamps', () => {
    expect(verifySignature({ rawBody: body, signature: sign('other', ts, body), timestamp: ts, secret, now: 1793931250 }).ok).toBe(false);
    expect(verifySignature({ rawBody: body, secret }).ok).toBe(false);
    expect(verifySignature({ rawBody: body, signature: sign(secret, ts, body), timestamp: ts, secret, now: 1793931249 + 4000 }).ok).toBe(false);
  });
  it('matches the format in Chatwoot lib/webhooks/trigger.rb (sha256= + hex of "ts.body")', () => {
    expect(sign(secret, ts, body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});
