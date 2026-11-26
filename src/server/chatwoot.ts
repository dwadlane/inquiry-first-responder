/** Shapes we read from Chatwoot Agent Bot webhooks. Only the fields we use. */
export interface WebhookContact {
  id?: number;
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
}

export interface MessageCreatedPayload {
  event: string;
  id?: number;
  content?: string | null;
  /** Chatwoot sends the enum name as a string in webhooks: incoming, outgoing, activity, template. */
  message_type?: string;
  private?: boolean;
  content_type?: string;
  /** ISO string or unix seconds, depending on the Chatwoot version. */
  created_at?: string | number;
  account?: { id: number; name?: string };
  inbox?: { id: number; name?: string };
  conversation?: { id: number; status?: string; inbox_id?: number; channel?: string; assignee_type?: string | null };
  sender?: WebhookContact & { type?: string };
  attachments?: unknown[];
}

export interface ChatwootApi {
  sendMessage(accountId: number, conversationId: number, content: string, opts?: { private?: boolean }): Promise<void>;
  setStatus(accountId: number, conversationId: number, status: 'open' | 'pending' | 'resolved'): Promise<void>;
  setLabels(accountId: number, conversationId: number, labels: string[]): Promise<void>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json?(): Promise<any>;
}>;

/**
 * Talks to the Chatwoot application API as the Agent Bot.
 * Agent bot tokens go in the `api_access_token` header.
 *   POST /api/v1/accounts/{account}/conversations/{conv}/messages
 *   POST /api/v1/accounts/{account}/conversations/{conv}/toggle_status
 *   POST /api/v1/accounts/{account}/conversations/{conv}/labels
 */
export class ChatwootClient implements ChatwootApi {
  constructor(
    private readonly opts: { baseUrl: string; token: string; fetch?: FetchLike }
  ) {}

  private async send(method: 'GET' | 'POST', path: string, body?: unknown) {
    const f = this.opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    const res = await f(this.opts.baseUrl.replace(/\/+$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', api_access_token: this.opts.token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (!res.ok) throw new Error(`Chatwoot ${path} returned ${res.status}`);
    return res;
  }

  private async post(path: string, body: unknown): Promise<void> {
    await this.send('POST', path, body);
  }

  private conv(a: number, c: number) {
    return `/api/v1/accounts/${a}/conversations/${c}`;
  }

  sendMessage(accountId: number, conversationId: number, content: string, o: { private?: boolean } = {}) {
    return this.post(`${this.conv(accountId, conversationId)}/messages`, {
      content,
      message_type: 'outgoing',
      private: Boolean(o.private)
    });
  }

  setStatus(accountId: number, conversationId: number, status: 'open' | 'pending' | 'resolved') {
    return this.post(`${this.conv(accountId, conversationId)}/toggle_status`, { status });
  }

  /**
   * Chatwoot's labels endpoint replaces the whole list, so read the current
   * labels first and send the union. Otherwise a person's labels would be wiped.
   */
  async setLabels(accountId: number, conversationId: number, labels: string[]) {
    const path = `${this.conv(accountId, conversationId)}/labels`;
    let existing: string[] = [];
    try {
      const res = await this.send('GET', path);
      const data = res.json ? await res.json() : JSON.parse(await res.text());
      if (Array.isArray(data?.payload)) existing = data.payload.filter((x: unknown): x is string => typeof x === 'string');
    } catch {
      // If we cannot read them, still add ours rather than skipping the handoff labels.
    }
    await this.post(path, { labels: [...new Set([...existing, ...labels])] });
  }
}

/** Client used when no Chatwoot URL is set: logs what it would do. */
export class DryRunClient implements ChatwootApi {
  readonly calls: { kind: string; args: unknown[] }[] = [];
  constructor(private readonly log: (line: string) => void = console.log) {}
  async sendMessage(a: number, c: number, content: string, o: { private?: boolean } = {}) {
    this.calls.push({ kind: 'sendMessage', args: [a, c, content, o] });
    this.log(`[dry run] ${o.private ? 'private note' : 'reply'} to conversation ${c}:\n${content}`);
  }
  async setStatus(a: number, c: number, status: string) {
    this.calls.push({ kind: 'setStatus', args: [a, c, status] });
    this.log(`[dry run] conversation ${c} status -> ${status}`);
  }
  async setLabels(a: number, c: number, labels: string[]) {
    this.calls.push({ kind: 'setLabels', args: [a, c, labels] });
    this.log(`[dry run] conversation ${c} labels -> ${labels.join(', ')}`);
  }
}
