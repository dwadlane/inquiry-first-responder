import { newState, step } from '../engine/engine.js';
import type { BusinessConfig, ConversationState } from '../engine/types.js';
import type { ChatwootApi, MessageCreatedPayload } from './chatwoot.js';
import { rulesDrafter, type Drafter } from './drafter.js';

export interface StateStore {
  get(key: string): ConversationState | undefined;
  set(key: string, state: ConversationState): void;
}

/** In-memory store with a time limit. A restart forgets open chats; the bot then starts the questions again. */
export class MemoryStore implements StateStore {
  private readonly map = new Map<string, { state: ConversationState; at: number }>();
  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000, private readonly now: () => number = Date.now) {}
  get(key: string) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.state;
  }
  set(key: string, state: ConversationState) {
    // Delete first so an updated chat moves to the newest position (true least recently used).
    this.map.delete(key);
    this.map.set(key, { state, at: this.now() });
    if (this.map.size > 5000) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

export type Outcome =
  | { kind: 'ignored'; why: string }
  | { kind: 'replied'; reply: string }
  | { kind: 'handed_off'; reply: string; reason: string };

export interface HandlerDeps {
  api: ChatwootApi;
  business: BusinessConfig;
  store: StateStore;
  drafter?: Drafter;
  log?: (line: string) => void;
  /** Waits between attempts to put a chat in front of a person. */
  openRetryDelaysMs?: number[];
  now?: () => number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Tries to move a chat to "open" a few times. Returns true when it worked. */
export async function openWithRetry(api: ChatwootApi, accountId: number, convId: number, delays: number[] = [0, 500, 2000]): Promise<boolean> {
  for (const d of delays) {
    if (d > 0) await sleep(d);
    try {
      await api.setStatus(accountId, convId, 'open');
      return true;
    } catch {
      /* try again */
    }
  }
  return false;
}

function createdAtMs(p: MessageCreatedPayload): number | undefined {
  const c = p.created_at;
  if (typeof c === 'number') return c < 1e12 ? c * 1000 : c;
  if (typeof c === 'string') {
    const t = Date.parse(c);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

/**
 * Decides whether a webhook is something the bot should answer.
 * Chatwoot sends many events; the bot only answers a new, public, incoming
 * message in a conversation that is still "pending" (the bot's queue).
 */
export function shouldHandle(p: MessageCreatedPayload): { ok: true } | { ok: false; why: string } {
  if (p.event !== 'message_created') return { ok: false, why: `event ${p.event} not handled` };
  if (p.message_type !== 'incoming') return { ok: false, why: 'not an incoming message' };
  if (p.private) return { ok: false, why: 'private note' };
  if (p.conversation?.status !== 'pending') return { ok: false, why: 'conversation is not pending, a person owns it' };
  if (typeof p.account?.id !== 'number' || typeof p.conversation?.id !== 'number') return { ok: false, why: 'missing account or conversation id' };
  return { ok: true };
}

export async function processEvent(p: MessageCreatedPayload, deps: HandlerDeps): Promise<Outcome> {
  const gate = shouldHandle(p);
  if (!gate.ok) return { kind: 'ignored', why: gate.why };
  const accountId = p.account!.id;
  const convId = p.conversation!.id;
  const key = `${accountId}:${convId}`;
  const found = deps.store.get(key);
  const nowMs = (deps.now ?? Date.now)();
  if (found?.stage === 'handed_off') {
    // A message that was sent before the handoff finished arrives with a stale "pending" status.
    // A person owns the chat now, so the bot must stay quiet.
    const sent = createdAtMs(p);
    const handedAt = found.handedOffAt ?? 0;
    const stale = sent !== undefined ? sent <= handedAt : nowMs - handedAt < 60_000;
    if (stale) return { kind: 'ignored', why: 'message arrived around a handoff, a person owns the chat' };
  }
  // If a finished chat really comes back to pending later, start the questions again.
  const start = !found || found.stage === 'handed_off' ? newState() : found;

  const result = step(start, p.content ?? '', deps.business, {
    knownContact: {
      name: p.sender?.name ?? undefined,
      phone: p.sender?.phone_number ?? undefined,
      email: p.sender?.email ?? undefined
    },
    attachments: p.attachments?.length ?? 0
  });
  deps.store.set(key, result.state);

  let reply = result.reply;
  if (!result.locked && reply) {
    try {
      reply = await (deps.drafter ?? rulesDrafter).reword({ planned: reply, customerText: p.content ?? '', business: deps.business });
    } catch {
      reply = result.reply;
    }
  }

  try {
    if (reply) await deps.api.sendMessage(accountId, convId, reply);
    if (result.handoff) {
      await deps.api.sendMessage(accountId, convId, result.handoff.summary, { private: true });
      await deps.api.setLabels(accountId, convId, result.handoff.labels);
      await deps.api.setStatus(accountId, convId, 'open');
      deps.store.set(key, { ...result.state, handedOffAt: (deps.now ?? Date.now)() });
    }
  } catch (e) {
    deps.log?.(`Chatwoot API call failed for conversation ${convId}: ${e instanceof Error ? e.message : e}`);
    // Never leave a customer waiting on a broken bot. Put the chat in front of a person.
    if (!(await openWithRetry(deps.api, accountId, convId, deps.openRetryDelaysMs))) {
      deps.log?.(`Could not move conversation ${convId} to open. The server will keep trying.`);
    }
    throw e;
  }

  return result.handoff
    ? { kind: 'handed_off', reply, reason: result.handoff.reason }
    : { kind: 'replied', reply };
}

/** Runs jobs for the same conversation one at a time, so quick messages cannot race. */
export class KeyedQueue {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(job);
    this.tails.set(key, next);
    next.finally(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }).catch(() => undefined);
    return next;
  }
}
