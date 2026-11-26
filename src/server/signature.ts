import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyInput {
  rawBody: string;
  signature?: string;
  timestamp?: string;
  secret: string;
  /** Current time in seconds. Injected for tests. */
  now?: number;
  /** How far the timestamp may be from now, in seconds. */
  toleranceSeconds?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Chatwoot signs agent bot deliveries like this (see lib/webhooks/trigger.rb):
 *   X-Chatwoot-Timestamp: unix seconds
 *   X-Chatwoot-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<raw body>")
 */
export function sign(secret: string, timestamp: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifySignature(input: VerifyInput): VerifyResult {
  const { rawBody, signature, timestamp, secret } = input;
  if (!signature || !timestamp) return { ok: false, reason: 'missing signature headers' };
  if (!/^\d{9,12}$/.test(timestamp)) return { ok: false, reason: 'bad timestamp' };
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - Number(timestamp)) > tolerance) return { ok: false, reason: 'timestamp too old or too new' };
  const expected = Buffer.from(sign(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}
