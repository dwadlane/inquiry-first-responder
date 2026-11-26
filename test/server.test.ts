import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { sampleBusiness } from '../src/engine/index.js';
import { ChatwootClient } from '../src/server/chatwoot.js';
import { createFirstResponder } from '../src/server/server.js';
import { sign } from '../src/server/signature.js';
import { messageCreated } from './fixtures/payloads.js';

const SECRET = 'unit-test-value';
const open: Server[] = [];
afterEach(() => { while (open.length) open.pop()!.close(); });

async function listen(s: Server) {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  open.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

/** A tiny stand-in for the Chatwoot API that records what the bot calls. */
async function fakeChatwoot() {
  const calls: { url: string; token?: string; body: any }[] = [];
  const s = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      calls.push({ url: req.url!, token: req.headers['api_access_token'] as string, body: JSON.parse(b || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return { url: await listen(s), calls };
}

async function post(base: string, payload: unknown, o: { secret?: string; delivery?: string; tamper?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (o.secret !== undefined) {
    headers['X-Chatwoot-Timestamp'] = ts;
    headers['X-Chatwoot-Signature'] = sign(o.secret, ts, body);
  }
  if (o.delivery) headers['X-Chatwoot-Delivery'] = o.delivery;
  return fetch(base + '/webhook', { method: 'POST', headers, body: o.tamper ? body + ' ' : body });
}

describe('webhook server', () => {
  it('verifies the signature, answers fast, and calls the Chatwoot API as the bot', async () => {
    const cw = await fakeChatwoot();
    const fr = createFirstResponder({
      api: new ChatwootClient({ baseUrl: cw.url, token: 'bot-token-for-test' }),
      business: sampleBusiness,
      webhookSecret: SECRET
    });
    const base = await listen(fr.server);
    const res = await post(base, messageCreated({ content: "EV charger in Oakfield, flexible. I'm Jo Park, jo@example.com" }), { secret: SECRET, delivery: 'd-1' });
    expect(res.status).toBe(200);
    await fr.idle();
    const urls = cw.calls.map((c) => c.url);
    expect(urls).toEqual([
      '/api/v1/accounts/1/conversations/42/messages',
      '/api/v1/accounts/1/conversations/42/messages',
      '/api/v1/accounts/1/conversations/42/labels',
      '/api/v1/accounts/1/conversations/42/labels',
      '/api/v1/accounts/1/conversations/42/toggle_status'
    ]);
    expect(cw.calls.every((c) => c.token === 'bot-token-for-test')).toBe(true);
    expect(cw.calls[0].body).toMatchObject({ message_type: 'outgoing', private: false });
    expect(cw.calls[1].body.private).toBe(true);
    expect(cw.calls[4].body).toEqual({ status: 'open' });
  });

  it('rejects bad or missing signatures and does nothing', async () => {
    const cw = await fakeChatwoot();
    const fr = createFirstResponder({ api: new ChatwootClient({ baseUrl: cw.url, token: 't' }), business: sampleBusiness, webhookSecret: SECRET });
    const base = await listen(fr.server);
    expect((await post(base, messageCreated(), {})).status).toBe(401);
    expect((await post(base, messageCreated(), { secret: 'wrong' })).status).toBe(401);
    expect((await post(base, messageCreated(), { secret: SECRET, tamper: true })).status).toBe(401);
    await fr.idle();
    expect(cw.calls).toHaveLength(0);
  });

  it('ignores a repeated delivery id (Chatwoot retries on 429 and 500)', async () => {
    const cw = await fakeChatwoot();
    const fr = createFirstResponder({ api: new ChatwootClient({ baseUrl: cw.url, token: 't' }), business: sampleBusiness, webhookSecret: SECRET });
    const base = await listen(fr.server);
    await post(base, messageCreated(), { secret: SECRET, delivery: 'same' });
    const again = await post(base, messageCreated(), { secret: SECRET, delivery: 'same' });
    expect(await again.json()).toMatchObject({ duplicate: true });
    await fr.idle();
    expect(cw.calls).toHaveLength(1);
  });

  it('refuses to start without a secret unless unsigned mode is explicit', () => {
    expect(() => createFirstResponder({ api: new ChatwootClient({ baseUrl: 'http://x', token: 't' }), business: sampleBusiness })).toThrow(/secret is required/);
  });

  it('serves a health check and rejects other paths and bad json', async () => {
    const cw = await fakeChatwoot();
    const fr = createFirstResponder({ api: new ChatwootClient({ baseUrl: cw.url, token: 't' }), business: sampleBusiness, allowUnsigned: true });
    const base = await listen(fr.server);
    expect((await fetch(base + '/health')).status).toBe(200);
    expect((await fetch(base + '/nope')).status).toBe(404);
    expect((await fetch(base + '/webhook', { method: 'POST', body: '{not json' })).status).toBe(400);
  });

  it('does not let a changed delivery header replay a signed message', async () => {
    const cw = await fakeChatwoot();
    const fr = createFirstResponder({ api: new ChatwootClient({ baseUrl: cw.url, token: 't' }), business: sampleBusiness, webhookSecret: SECRET });
    const base = await listen(fr.server);
    const payload = messageCreated({ content: 'lights flickering' });
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = { 'Content-Type': 'application/json', 'X-Chatwoot-Timestamp': ts, 'X-Chatwoot-Signature': sign(SECRET, ts, body) };
    await fetch(base + '/webhook', { method: 'POST', headers: { ...headers, 'X-Chatwoot-Delivery': 'a' }, body });
    await fetch(base + '/webhook', { method: 'POST', headers: { ...headers, 'X-Chatwoot-Delivery': 'b' }, body });
    await fetch(base + '/webhook', { method: 'POST', headers, body });
    await fr.idle();
    expect(cw.calls).toHaveLength(1);
  });

  it('accepts the webhook path with a query string', async () => {
    const cw = await fakeChatwoot();
    const fr = createFirstResponder({ api: new ChatwootClient({ baseUrl: cw.url, token: 't' }), business: sampleBusiness, allowUnsigned: true });
    const base = await listen(fr.server);
    const res = await fetch(base + '/webhook?x=1', { method: 'POST', body: JSON.stringify(messageCreated()) });
    expect(res.status).toBe(200);
    await fr.idle();
  });

  it('keeps trying to open the chat in the background when a job and its status call both fail', async () => {
    let tries = 0;
    const api = {
      async sendMessage() { throw new Error('down'); },
      async setLabels() {},
      async setStatus() { tries++; if (tries < 4) throw new Error('down'); }
    };
    const fr = createFirstResponder({ api, business: sampleBusiness, allowUnsigned: true, retryDelaysMs: [5, 5, 5, 5], openRetryDelaysMs: [0] });
    const base = await listen(fr.server);
    await fetch(base + '/webhook', { method: 'POST', body: JSON.stringify(messageCreated()) });
    await fr.idle();
    await new Promise((r) => setTimeout(r, 120));
    expect(tries).toBeGreaterThanOrEqual(4);
  });
});

describe('ChatwootClient labels', () => {
  it('adds to the labels a person already set instead of replacing them', async () => {
    const sent: { method: string; body?: string }[] = [];
    const client = new ChatwootClient({
      baseUrl: 'http://x',
      token: 't',
      fetch: async (_u, init) => {
        sent.push({ method: init.method, body: init.body });
        return { ok: true, status: 200, text: async () => '', json: async () => ({ payload: ['vip'] }) };
      }
    });
    await client.setLabels(1, 2, ['first-responder', 'vip']);
    expect(sent[0].method).toBe('GET');
    expect(JSON.parse(sent[1].body!)).toEqual({ labels: ['vip', 'first-responder'] });
  });
});
