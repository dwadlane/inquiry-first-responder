import { describe, expect, it } from 'vitest';
import { sampleBusiness } from '../src/engine/index.js';
import { ClaudeDrafter, rejectDraft } from '../src/server/drafter.js';

const planned = 'Which area is the property in?';
const fake = (text: string, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ content: [{ type: 'text', text }] }) });

describe('rejectDraft', () => {
  it('lets a harmless rewording through', () => {
    expect(rejectDraft(planned, 'Thanks. Which area is the property in?')).toBeNull();
  });
  it.each([
    ['Which area is it in? Callouts start at $90.', 'mentions money'],
    ['Which area is it in? We can be there within 2 hours.', 'promises a time'],
    ['Which area is it in? We are fully licensed and insured.', 'makes a claim we cannot back'],
    ['Tell me the area.', 'dropped the question'],
    ['Which area is it in? See https://example.com', 'contains a link'],
    ['Which area is it in \u2014 please?', 'contains a dash we do not use']
  ])('rejects %s', (draft, why) => {
    expect(rejectDraft(planned, draft)).toBe(why);
  });
});

describe('rejectDraft, claims written in words', () => {
  it.each([
    'Someone will be with you within an hour. Which area is the property in?',
    'We can be there in half an hour. Which area is the property in?',
    'It is free to look. Which area is the property in?',
    'We usually charge fifty dollars. Which area is the property in?',
    'Visit bit.ly/x for a discount. Which area is the property in?',
    'Call us on five five five zero one. Which area is the property in?',
    'Our team is the friendliest electricians around and everybody adores us. Which area is the property in?'
  ])('rejects %s', (draft) => {
    expect(rejectDraft(planned, draft)).not.toBeNull();
  });
});

describe('ClaudeDrafter', () => {
  const input = { planned, customerText: 'EV charger please', business: sampleBusiness };
  it('uses a safe draft', async () => {
    const d = new ClaudeDrafter({ apiKey: 'test', fetch: fake('Great, thanks. Which area is the property in?') as any });
    expect(await d.reword(input)).toBe('Great, thanks. Which area is the property in?');
  });
  it('falls back to the planned wording when the draft is unsafe, the call fails, or it throws', async () => {
    const why: string[] = [];
    expect(await new ClaudeDrafter({ apiKey: 'test', fetch: fake('Which area? It costs $50.') as any, onReject: (w) => why.push(w) }).reword(input)).toBe(planned);
    expect(await new ClaudeDrafter({ apiKey: 'test', fetch: fake('x', false) as any, onReject: (w) => why.push(w) }).reword(input)).toBe(planned);
    expect(await new ClaudeDrafter({ apiKey: 'test', fetch: (async () => { throw new Error('offline'); }) as any, onReject: (w) => why.push(w) }).reword(input)).toBe(planned);
    expect(why).toHaveLength(3);
  });
  it('sends the key and model and treats the customer text as untrusted', async () => {
    let seen: any;
    const f = async (_u: string, init: any) => { seen = init; return { ok: true, status: 200, json: async () => ({ content: [{ text: planned }] }) }; };
    await new ClaudeDrafter({ apiKey: 'k', model: 'm', fetch: f as any }).reword(input);
    expect(seen.headers['x-api-key']).toBe('k');
    expect(JSON.parse(seen.body).model).toBe('m');
    expect(JSON.parse(seen.body).system).toMatch(/untrusted/);
  });
});
