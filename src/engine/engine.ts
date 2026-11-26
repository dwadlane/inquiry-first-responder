import {
  asksAreas,
  asksAvailability,
  asksForHuman,
  asksPrice,
  asksServices,
  bareName,
  detectArea,
  detectEmail,
  detectJob,
  detectName,
  nameBeforeContact,
  detectPhone,
  detectUrgency,
  isComplaint,
  isEmergency,
  isGreetingOnly,
  isPlaceholderName,
  looksLikeQuestion
} from './extract.js';
import { buildSummary, hasContact } from './summary.js';
import type { BusinessConfig, ConversationState, Flag, Handoff, StepOptions, StepResult } from './types.js';

export function newState(): ConversationState {
  return { stage: 'collecting', slots: {}, flags: [], unclear: 0, turns: 0, transcript: [] };
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function addFlag(state: ConversationState, flag: Flag) {
  if (!state.flags.some((f) => f.kind === flag.kind)) state.flags.push(flag);
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])([a-z']*)/gi, (_m, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
}

/** Words that follow "in" or "at" in a sentence but are not a place. */
const PLACE_REJECT =
  /^(The|My|Our|A|An|This|That|These|Those|Kitchen|Bathroom|Garage|Bedroom|Basement|Hallway|Living|Attic|Loft|Cellar|Office|Shop|Store|Front|Back|Rear|Free|Half|Full|Price|Today|Tomorrow|Tonight|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Case|Fact|General|Particular|Total|Need|Time|Minutes|Hours|Days|Weeks|Home|House|Work|Town|Here|There|Short|Case|Emergency|Urgent|Flexible)$/;

const NOT_AN_AREA = new Set('yes no ok okay sure maybe idk dunno what why how who when where huh hello hi hey thanks thank please none nothing everywhere anywhere nowhere unknown not know dont don\'t'.split(' '));

type Missing = 'job' | 'area' | 'urgency' | 'contact';

function missing(state: ConversationState): Missing[] {
  const s = state.slots;
  const out: Missing[] = [];
  if (!s.jobType) out.push('job');
  if (!s.area) out.push('area');
  if (!s.urgency) out.push('urgency');
  if (!hasContact(s)) out.push('contact');
  return out;
}

function question(state: ConversationState, config: BusinessConfig, what: Missing): string {
  const s = state.slots;
  switch (what) {
    case 'job':
      return 'What do you need help with? For example a power problem, outlets or lighting, an EV charger, a fuse box upgrade, or an inspection.';
    case 'area':
      return 'Which area is the property in?';
    case 'urgency':
      return 'How urgent is it: today, this week, or flexible?';
    case 'contact':
      if (!s.name && !s.phone && !s.email) return 'Last thing. What name should we use, and what is the best phone number or email to reach you?';
      if (!s.name) return 'What name should we use for you?';
      return 'What is the best phone number or email to reach you?';
  }
}

function handoffLabels(state: ConversationState): string[] {
  const labels = ['first-responder'];
  const u = state.slots.urgency;
  if (u === 'emergency') labels.push('emergency');
  if (u === 'emergency' || u === 'today') labels.push('urgent');
  for (const f of state.flags) {
    if (f.kind === 'price_question') labels.push('price-question');
    if (f.kind === 'availability_question') labels.push('availability-question');
    if (f.kind === 'area_not_listed') labels.push('check-area');
    if (f.kind === 'complaint') labels.push('complaint');
  }
  return [...new Set(labels)];
}

function finish(
  state: ConversationState,
  config: BusinessConfig,
  reply: string,
  reason: string,
  urgent: boolean
): StepResult {
  state.stage = 'handed_off';
  state.transcript.push({ from: 'bot', text: reply });
  const handoff: Handoff = {
    reason,
    urgent,
    summary: buildSummary(state, config, reason),
    labels: handoffLabels(state)
  };
  return { state, reply, handoff, locked: true };
}

function askForContactSuffix(state: ConversationState): string {
  return hasContact(state.slots) ? '' : ' If you can, add your name and the best phone number or email so they can reach you.';
}

export function step(
  prev: ConversationState,
  rawText: string,
  config: BusinessConfig,
  opts: StepOptions = {}
): StepResult {
  const state = clone(prev);
  const text = (rawText ?? '').trim();

  if (state.stage === 'handed_off') {
    return { state, reply: '', locked: true };
  }

  state.turns += 1;
  if (text) state.transcript.push({ from: 'customer', text });
  const s = state.slots;

  // Seed contact from the chat channel (for example the Chatwoot contact).
  const kc = opts.knownContact;
  if (kc) {
    if (!s.name && kc.name && !isPlaceholderName(kc.name)) s.name = kc.name;
    if (!s.phone && kc.phone) s.phone = kc.phone;
    if (!s.email && kc.email) s.email = kc.email;
  }
  if (opts.attachments) addFlag(state, { kind: 'attachment' });

  const expected = missing(state)[0];
  const first = state.turns === 1;
  const intro = first
    ? `Hi, I am ${config.botName}. I take down the details so the right person can pick it up quickly. I cannot give prices or book times myself.`
    : '';

  // 1. Safety first.
  if (isEmergency(text)) {
    s.urgency = 'emergency';
    s.jobType = s.jobType ?? detectJob(text);
    s.details = s.details ?? text.slice(0, 280);
    const area = detectArea(text, config);
    if (area) {
      s.area = area.name;
      s.areaListed = true;
    }
    const email = detectEmail(text);
    const phone = detectPhone(text);
    if (email) s.email = email;
    if (phone) s.phone = phone;
    addFlag(state, { kind: 'emergency' });
    // Keep the customer's price or timing question for the team, even though safety comes first.
    if (asksPrice(text)) addFlag(state, { kind: 'price_question' });
    if (asksAvailability(text)) addFlag(state, { kind: 'availability_question' });
    const reply = [
      config.emergencyAdvice,
      'I have marked this as urgent and I am passing it to a person right now.' + askForContactSuffix(state)
    ].join('\n\n');
    return finish(state, config, reply, 'Possible safety problem reported', true);
  }

  // 2. Wants a person.
  if (asksForHuman(text)) {
    addFlag(state, { kind: 'human_request' });
    const reply =
      'Of course. I am passing this to a person now with what you have told me so far. They will pick it up here.' +
      askForContactSuffix(state);
    return finish(state, config, reply, 'Customer asked for a person', false);
  }

  // 3. Complaints and existing jobs are not for a bot.
  if (isComplaint(text)) {
    addFlag(state, { kind: 'complaint' });
    const reply =
      'I am sorry about that. This one needs a person, so I am passing it on now with what you have told me. They will pick it up here.' +
      askForContactSuffix(state);
    return finish(state, config, reply, 'Looks like a complaint or an existing job', false);
  }

  // 4. Read everything useful out of the message.
  const before = JSON.stringify(s);
  const notes: string[] = [];
  const jobNow = detectJob(text);
  if (!s.jobType && jobNow) {
    s.jobType = jobNow;
    if (!s.details) s.details = text.slice(0, 280);
  }
  const areaNow = detectArea(text, config);
  if (!s.area && areaNow) {
    s.area = areaNow.name;
    s.areaListed = true;
    notes.push(`${areaNow.name} is one of the areas we serve.`);
  }
  // An area named inside a longer message, such as "downlights in Springfield".
  if (!s.area && !areaNow) {
    for (const m of text.matchAll(/(?<!\bnot )\b(?:in|at|near|around|out in)\s+([A-Z][a-z'-]+)\b/g)) {
      const cand = m[1].trim();
      if (!PLACE_REJECT.test(cand) && !detectArea(cand, config)) {
        s.area = cand;
        s.areaListed = false;
        addFlag(state, { kind: 'area_not_listed', text: cand });
        notes.push(`I do not have ${cand} on my list of areas, so I cannot confirm we cover it. A person will check that for you.`);
        break;
      }
    }
  }
  const urgNow = detectUrgency(text);
  if (!s.urgency && urgNow) s.urgency = urgNow;
  const email = detectEmail(text);
  if (!s.email && email) s.email = email;
  const phone = detectPhone(text);
  if (!s.phone && phone) s.phone = phone;
  const nameNow = detectName(text, config);
  if (!s.name && nameNow) s.name = nameNow;
  if (!s.name && (email || phone)) {
    const nb = nameBeforeContact(text);
    // Skip words that are place names we know or job words.
    if (nb && !detectArea(nb, config) && !detectJob(nb)) s.name = nb;
  }

  // Step-specific fallbacks for short, plain answers.
  const shortPlain = text.split(/\s+/).filter(Boolean).length <= 2 && !/\?/.test(text);
  if (expected === 'area' && !s.area && shortPlain && text && !urgNow && !jobNow && !email && !phone && !isGreetingOnly(text)) {
    const bare = text.replace(/^(it'?s |its |in |we'?re in |i'?m in |im in |at )/i, '').replace(/[.!]+$/, '').trim();
    const guess = titleCase(bare);
    const okWords = guess.split(' ').every((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w) && !PLACE_REJECT.test(w) && !NOT_AN_AREA.has(w.toLowerCase()));
    if (guess && guess.length <= 30 && okWords) {
      s.area = guess;
      s.areaListed = false;
      addFlag(state, { kind: 'area_not_listed', text: guess });
      notes.push(
        `I do not have ${guess} on my list of areas, so I cannot confirm we cover it. A person will check that for you.`
      );
    }
  }
  if (!s.name && (expected === 'contact' || missing(state)[0] === 'contact') && text) {
    const bn = bareName(text);
    if (bn && (email || phone || expected === 'contact')) s.name = bn;
  }

  const filled = JSON.stringify(s) !== before;

  // 5. Questions we must not answer.
  const price = asksPrice(text);
  const avail = asksAvailability(text);
  const askedBefore =
    (price && state.flags.some((f) => f.kind === 'price_question')) ||
    (avail && state.flags.some((f) => f.kind === 'availability_question'));
  if (price) {
    addFlag(state, { kind: 'price_question' });
  }
  if (avail) {
    addFlag(state, { kind: 'availability_question' });
  }
  let locked = false;
  if (price || avail) {
    locked = true;
    const what = price && avail ? 'prices or times' : price ? 'prices' : 'times';
    notes.push(
      `I cannot give ${what}. That has to come from a person who has seen the job. I have flagged your question for them.`
    );
  }

  // 6. Simple facts we do know.
  const asksSvc = asksServices(text);
  const asksAr = asksAreas(text);
  if (asksAr) notes.push(`We list these areas: ${config.areas.map((a) => a.name).join(', ')}.`);
  if (asksSvc) notes.push(`We take jobs for ${Object.values(config.services).join(', ')}.`);
  const faq = asksSvc || asksAr;

  // A question tucked inside a message that also filled a slot still has to reach the team.
  if (filled && !faq && !price && !avail) {
    const q = text.split(/(?<=[?.!])\s+/).find((x) => /\?/.test(x) && looksLikeQuestion(x));
    if (q) {
      addFlag(state, { kind: 'unanswered_question', text: q.trim().slice(0, 200) });
      notes.push('I have noted your question for the team. I cannot answer it myself.');
    }
  }

  // 7. A question we cannot answer goes to a person.
  if (!filled && !faq && !price && !avail && looksLikeQuestion(text) && !isGreetingOnly(text)) {
    addFlag(state, { kind: 'unanswered_question', text: text.slice(0, 200) });
    const reply =
      'That is a question for a person, and I do not want to guess. I am passing it on now with what you have told me so far.' +
      askForContactSuffix(state);
    return finish(state, config, reply, 'Customer asked something the bot cannot answer', false);
  }

  // 8. Did we understand anything?
  const understood = filled || /\b(electrician|electrical|electric|sparky|wiring)\b/i.test(text) || faq || price || avail || isGreetingOnly(text) || (first && !text);
  if (understood) state.unclear = 0;
  else state.unclear += 1;
  state.stalled = filled ? 0 : (state.stalled ?? 0) + 1;
  if (state.stalled >= 3 || (askedBefore && !filled)) {
    addFlag(state, { kind: 'unclear' });
    const reply =
      'I am not getting anywhere on my own, so I am passing you to a person now with what you have told me.' +
      askForContactSuffix(state);
    return finish(state, config, reply, 'Several messages in a row gave the bot nothing new to work with', false);
  }
  if (state.unclear >= 2) {
    addFlag(state, { kind: 'unclear' });
    const reply =
      'I am not sure I have understood, and I do not want to get this wrong. I am passing you to a person now.' +
      askForContactSuffix(state);
    return finish(state, config, reply, 'The bot could not make sense of the messages', false);
  }

  // 9. All details in? Hand off.
  const still = missing(state);
  if (still.length === 0) {
    const first1 = s.name ? s.name.split(' ')[0] : '';
    const jobText = s.jobType ? config.services[s.jobType] : 'your job';
    const parts = [
      `Thank you${first1 ? ', ' + first1 : ''}. I have passed your inquiry to a person with these details: ${jobText} in ${s.area}, urgency ${
        s.urgency === 'this_week' ? 'this week' : s.urgency
      }.`
    ];
    if (s.areaListed === false) parts.push(`They will confirm whether we cover ${s.area}.`);
    if (state.flags.some((f) => f.kind === 'price_question' || f.kind === 'availability_question'))
      parts.push('They will answer your question about price or timing.');
    else parts.push('They will cover price and timing with you, because I cannot.');
    parts.push('They will reply here.');
    if (notes.length && (price || avail)) parts.unshift(notes[notes.length - 1]);
    const reply = parts.join('\n\n');
    const reason = 'All details collected, ready for a person to quote and book';
    return finish(state, config, reply, reason, s.urgency === 'today');
  }

  // 10. Ask the next thing.
  const pieces: string[] = [];
  if (intro) pieces.push(intro);
  if (filled && s.jobType && !JSON.parse(before).jobType) pieces.push(`Got it, ${config.services[s.jobType]}.`);
  pieces.push(...notes);
  if (isGreetingOnly(text) && !intro) pieces.push('Hello again.');
  pieces.push(question(state, config, still[0]));
  if (state.unclear === 1 && !filled && !first) pieces.unshift('Sorry, I did not catch that.');
  const reply = pieces.join('\n\n');
  state.transcript.push({ from: 'bot', text: reply });
  return { state, reply, locked, handoff: undefined };
}
