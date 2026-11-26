import type { BusinessConfig, ConversationState, Flag, Slots, Urgency } from './types.js';

export const URGENCY_LABEL: Record<Urgency, string> = {
  emergency: 'Emergency, safety concern',
  today: 'Today',
  this_week: 'This week',
  flexible: 'Flexible'
};

/** Customer text goes into a private note. No links, no line breaks, so it cannot forge lines or be clicked. */
export function clean(t: string | undefined): string {
  return (t ?? '').replace(/https?:\/\/\S+|www\.\S+/gi, '[link removed]').replace(/\s+/g, ' ').trim();
}

export function contactLine(s: Slots): string {
  const parts = [s.name, s.phone, s.email].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Not given';
}

export function hasContact(s: Slots): boolean {
  return Boolean(s.name && (s.phone || s.email));
}

export function flagLine(f: Flag): string | undefined {
  switch (f.kind) {
    case 'emergency':
      return 'Customer described a possible safety problem. Call first.';
    case 'price_question':
      return 'Asked about price. The bot did not answer. A person needs to.';
    case 'availability_question':
      return 'Asked about timing or availability. The bot did not answer. A person needs to.';
    case 'human_request':
      return 'Asked to speak to a person.';
    case 'complaint':
      return 'Looks like a complaint or an existing job.';
    case 'unanswered_question':
      return `Question the bot could not answer: "${clean(f.text)}"`;
    case 'area_not_listed':
      return `Area is not on the service list. Please check coverage: ${clean(f.text)}`;
    case 'unclear':
      return 'The bot could not make sense of the message.';
    case 'attachment':
      return 'Customer sent a file or photo. Please look at it.';
  }
}

export function buildSummary(state: ConversationState, config: BusinessConfig, reason: string): string {
  const s = state.slots;
  const lines: string[] = [];
  lines.push(`First Responder summary for ${config.name}`);
  lines.push('');
  lines.push(`Why a person is needed: ${reason}`);
  lines.push('');
  lines.push(`Job: ${s.jobType ? config.services[s.jobType] : 'Not clear yet'}`);
  if (s.details) lines.push(`In their words: "${clean(s.details)}"`);
  lines.push(`Area: ${s.area ? clean(s.area) + (s.areaListed ? '' : ' (not on the service list)') : 'Not given'}`);
  lines.push(`Urgency: ${s.urgency ? URGENCY_LABEL[s.urgency] : 'Not given'}`);
  lines.push(`Contact: ${contactLine(s)}`);
  const flags = state.flags.map(flagLine).filter(Boolean) as string[];
  if (flags.length) {
    lines.push('');
    lines.push('Needs your attention:');
    for (const f of flags) lines.push(`- ${f}`);
  }
  lines.push('');
  lines.push('The bot has not quoted a price or promised a time.');
  return lines.join('\n');
}
