import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { BusinessConfig } from '../engine/types.js';
import type { ChatwootApi, MessageCreatedPayload } from './chatwoot.js';
import type { Drafter } from './drafter.js';
import { KeyedQueue, MemoryStore, processEvent, type StateStore } from './handler.js';
import { verifySignature } from './signature.js';

export interface ServerOptions {
  api: ChatwootApi;
  business: BusinessConfig;
  /** Required unless allowUnsigned is true. */
  webhookSecret?: string;
  allowUnsigned?: boolean;
  drafter?: Drafter;
  store?: StateStore;
  log?: (line: string) => void;
  maxBodyBytes?: number;
  now?: () => number;
  /** Background retries when a failed job could not hand the chat to a person. */
  retryDelaysMs?: number[];
  openRetryDelaysMs?: number[];
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createFirstResponder(opts: ServerOptions): { server: Server; idle(): Promise<void> } {
  if (!opts.webhookSecret && !opts.allowUnsigned) {
    throw new Error('A webhook secret is required. Set CHATWOOT_WEBHOOK_SECRET, or ALLOW_UNSIGNED=true for local experiments only.');
  }
  const log = opts.log ?? (() => {});
  const store = opts.store ?? new MemoryStore();
  const queue = new KeyedQueue();
  const seen = new Set<string>();
  const inflight = new Set<Promise<unknown>>();

  // If a job fails, Chatwoot has already been told "ok", so its own fallback never runs.
  // Keep trying to put the chat in front of a person.
  const retryOpenInBackground = (p: MessageCreatedPayload) => {
    const a = p.account?.id;
    const c = p.conversation?.id;
    if (typeof a !== 'number' || typeof c !== 'number') return;
    const delays = opts.retryDelaysMs ?? [5_000, 30_000, 120_000, 600_000];
    const attempt = (i: number) => {
      if (i >= delays.length) return log(`gave up moving conversation ${c} to open`);
      const t = setTimeout(async () => {
        try {
          await opts.api.setStatus(a, c, 'open');
          log(`conversation ${c}: moved to open on retry ${i + 1}`);
        } catch {
          attempt(i + 1);
        }
      }, delays[i]);
      t.unref?.();
    };
    attempt(0);
  };

  const server = createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true });
      if (req.method !== 'POST' || path !== '/webhook') return send(404, { error: 'not found' });

      const raw = await readBody(req, opts.maxBodyBytes ?? 1_000_000);
      if (opts.webhookSecret) {
        const v = verifySignature({
          rawBody: raw,
          signature: req.headers['x-chatwoot-signature'] as string | undefined,
          timestamp: req.headers['x-chatwoot-timestamp'] as string | undefined,
          secret: opts.webhookSecret,
          now: opts.now ? opts.now() : undefined
        });
        if (!v.ok) {
          log(`rejected webhook: ${v.reason}`);
          return send(401, { error: 'invalid signature' });
        }
      }

      let payload: MessageCreatedPayload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return send(400, { error: 'invalid json' });
      }

      // The delivery header is not covered by the signature, so it is not proof of anything.
      // The signed body is: dedupe on the message id inside it, scoped to account and conversation.
      if (typeof payload?.id === 'number') {
        const mkey = `msg:${payload.account?.id}:${payload.conversation?.id}:${payload.id}`;
        if (seen.has(mkey)) return send(200, { ok: true, duplicate: true });
        seen.add(mkey);
        if (seen.size > 4000) seen.delete(seen.values().next().value as string);
      }

      // Chatwoot retries on 429 and 500. A repeat delivery id means we already took it.
      const delivery = req.headers['x-chatwoot-delivery'] as string | undefined;
      if (delivery) {
        if (seen.has(delivery)) return send(200, { ok: true, duplicate: true });
        seen.add(delivery);
        if (seen.size > 2000) seen.delete(seen.values().next().value as string);
      }

      // Answer Chatwoot quickly, work in the background, one conversation at a time.
      const key = `${payload.account?.id}:${payload.conversation?.id}`;
      const job = queue
        .run(key, () =>
          processEvent(payload, { api: opts.api, business: opts.business, store, drafter: opts.drafter, log, now: opts.now ? () => opts.now!() * 1000 : undefined, openRetryDelaysMs: opts.openRetryDelaysMs })
        )
        .then((o) => log(`conversation ${payload.conversation?.id}: ${o.kind}${o.kind === 'ignored' ? ' (' + o.why + ')' : ''}`))
        .catch((e) => {
          log(`error: ${e instanceof Error ? e.message : e}`);
          retryOpenInBackground(payload);
        });
      inflight.add(job);
      job.finally(() => inflight.delete(job));
      return send(200, { ok: true });
    } catch (e) {
      log(`request failed: ${e instanceof Error ? e.message : e}`);
      return send(400, { error: 'bad request' });
    }
  });

  return { server, idle: async () => void (await Promise.all([...inflight])) };
}
