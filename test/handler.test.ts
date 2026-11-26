import { describe, expect, it } from 'vitest';
import { sampleBusiness } from '../src/engine/index.js';
import { DryRunClient, type ChatwootApi } from '../src/server/chatwoot.js';
import { MemoryStore, processEvent } from '../src/server/handler.js';
import { messageCreated } from './fixtures/payloads.js';

const deps = () => ({ api: new DryRunClient(() => {}), business: sampleBusiness, store: new MemoryStore() });

describe('processEvent', () => {
  it('replies to a new incoming message in a pending conversation', async () => {
    const d = deps();
    const out = await processEvent(messageCreated(), d);
    expect(out.kind).toBe('replied');
    expect(d.api.calls[0]).toMatchObject({ kind: 'sendMessage', args: [1, 42, expect.any(String), expect.anything()] });
  });

  it('ignores events and messages it should not answer', async () => {
    const d = deps();
    for (const p of [
      messageCreated({ event: 'conversation_updated' }),
      messageCreated({ messageType: 'outgoing' }),
      messageCreated({ messageType: 'activity' }),
      messageCreated({ isPrivate: true }),
      messageCreated({ status: 'open' }),
      messageCreated({ status: 'resolved' })
    ]) {
      expect((await processEvent(p, d)).kind).toBe('ignored');
    }
    expect(d.api.calls).toHaveLength(0);
  });

  it('keeps state across messages and hands off: reply, private note, labels, status open', async () => {
    const d = deps();
    for (const c of ['half my house lost power', 'Oakfield', 'today']) await processEvent(messageCreated({ content: c }), d);
    const out = await processEvent(messageCreated({ content: 'Sam Rivera 555 010 2233' }), d);
    expect(out.kind).toBe('handed_off');
    const kinds = d.api.calls.slice(-4).map((c) => c.kind + (c.kind === 'sendMessage' ? ((c.args[3] as any)?.private ? ':private' : ':public') : ''));
    expect(kinds).toEqual(['sendMessage:public', 'sendMessage:private', 'setLabels', 'setStatus']);
    expect(d.api.calls[d.api.calls.length - 1].args[2]).toBe('open');
  });

  it('keeps separate conversations separate', async () => {
    const d = deps();
    await processEvent(messageCreated({ convId: 1, content: 'EV charger please' }), d);
    const out = await processEvent(messageCreated({ convId: 2, content: 'Oakfield' }), d);
    expect(out.kind).toBe('replied');
    expect(d.store.get('1:1')!.slots.jobType).toBe('ev_charger');
    expect(d.store.get('1:2')!.slots.jobType).toBeUndefined();
  });

  it('uses the contact name and email Chatwoot sends, not generated visitor names', async () => {
    const d = deps();
    await processEvent(messageCreated({ content: 'EV charger in Westbrook, this week', senderName: 'Lee Chen', senderEmail: 'lee@example.com' }), d);
    expect(d.store.get('1:42')!.stage).toBe('handed_off');
  });

  it('puts the chat in front of a person if the Chatwoot API fails mid-reply', async () => {
    const calls: string[] = [];
    const api: ChatwootApi = {
      async sendMessage() { calls.push('send'); throw new Error('boom'); },
      async setStatus(_a, _c, s) { calls.push('status:' + s); },
      async setLabels() {}
    };
    await expect(processEvent(messageCreated(), { api, business: sampleBusiness, store: new MemoryStore() })).rejects.toThrow('boom');
    expect(calls).toEqual(['send', 'status:open']);
  });

  it('stays silent when a message that was sent before the handoff arrives afterwards', async () => {
    const d = deps();
    const first = await processEvent(messageCreated({ content: 'I smell burning from the outlet', id: 1001 }), d);
    expect(first.kind).toBe('handed_off');
    const callsAfterHandoff = d.api.calls.length;
    // Sent while the bot was still working, so it still says "pending".
    const late = await processEvent(messageCreated({ content: 'it is in Oakfield', id: 1002 }), d);
    expect(late.kind).toBe('ignored');
    expect(d.api.calls).toHaveLength(callsAfterHandoff);
  });

  it('starts the questions again when a chat truly returns to pending after the handoff', async () => {
    const d = deps();
    await processEvent(messageCreated({ content: 'can I speak to a person', id: 1001 }), d);
    const later = new Date(Date.now() + 60_000).toISOString();
    const out = await processEvent(messageCreated({ content: 'EV charger please', id: 2001, createdAt: later }), d);
    expect(out.kind).toBe('replied');
  });

  it('keeps retrying to open the chat when both the reply and the status call fail', async () => {
    let statusTries = 0;
    const api: ChatwootApi = {
      async sendMessage() { throw new Error('boom'); },
      async setStatus() { statusTries++; if (statusTries < 3) throw new Error('down'); },
      async setLabels() {}
    };
    await expect(
      processEvent(messageCreated(), { api, business: sampleBusiness, store: new MemoryStore(), openRetryDelaysMs: [0, 1, 1] })
    ).rejects.toThrow('boom');
    expect(statusTries).toBe(3);
  });
});

describe('MemoryStore', () => {
  it('keeps a chat that was just updated, even after thousands of other chats', () => {
    const st = new MemoryStore();
    st.set('active', { n: 0 } as any);
    for (let i = 0; i < 4999; i++) st.set('k' + i, {} as any);
    st.set('active', { n: 1 } as any);
    st.set('new', {} as any);
    expect(st.get('active')).toEqual({ n: 1 });
  });
});
