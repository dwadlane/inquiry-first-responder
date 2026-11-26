import type { BusinessConfig, JobKey, Urgency } from './types.js';

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Words that make a smoke ALARM job not an emergency. */
const ALARM_PHRASE = /\b(smoke|fire|co|carbon monoxide) (alarm|alarms|detector|detectors)\b/g;

/**
 * Broad on purpose. A false alarm costs a phone call; a miss can cost a house.
 * Anything that sounds like heat, burning, sparks, shock, noise from live gear or a smell goes to a person.
 */
const EMERGENCY =
  /\b(spark\w*|burn\w*|burnt|scorch\w*|charred|char|smok\w*|flames?|flaming|on fire|caught fire|fire|arc|arcs|arced|arcing|zap\w*|tingl\w*|electrocut\w*|shock\w*|got a shock|gave me a shock|melt\w*|hot to the touch|red hot|overheat\w*|sizzl\w*|crackl\w*|buzz\w*|hum|hums|humming|smell\w*|stink\w*|stench|fumes?|short[- ]?circuit\w*|exposed (wire|wires|wiring)|live (wire|wires)|bare wires?|water (in|near|on|into|got into|leaking into) (the )?(outlet|socket|panel|fuse ?box|wiring|breaker|box|electrics?)|emerg\w*|ember|embers)\b/;

/** Heat words only matter beside something electrical. */
const HEAT_WORD = /\b(hot|warm|heating up|heats up|getting hot|too hot)\b/;
const ELECTRICAL_THING = /\b(outlets?|sockets?|plugs?|walls?|panels?|fuse ?box|breakers?|box|cords?|wires?|wiring|switch(es)?|chargers?|fuses?|consumer unit|meter|cable|cables|extension|power ?strip)\b/;
const ALARM_GOING_OFF = /\b(smoke|fire|co|carbon monoxide) (alarm|alarms|detector|detectors)\b[^.]{0,40}\b(going off|went off|sounding|blaring|screaming|will not stop|won't stop|keeps going off)\b/;

/** A downed line is live until proven otherwise. */
const DOWNED_LINE = /\b((power|electric\w*|utility|live) (lines?|wires?|cables?)\b[^.]{0,30}\b(down|fallen|fell|snapped|on the ground|in my yard)|(downed|fallen) (power |electric\w* |utility |live )?(lines?|wires?|cables?))\b/;

export function isEmergency(text: string): boolean {
  let t = norm(text);
  // "not an emergency" is the one phrase that cancels the word.
  t = t.replace(/\bemergency (lights?|lighting|exit|fixtures?)\b/g, ' ');
  t = t.replace(/\b(not|no|isn't|is not|wasn't|non)[- ](an? )?emerg\w*/g, ' ');
  if (DOWNED_LINE.test(t)) return true;
  if (ALARM_GOING_OFF.test(t)) return true;
  t = t.replace(ALARM_PHRASE, ' alarm ');
  if (EMERGENCY.test(t)) return true;
  const hot = t.replace(/warm white/g, ' ');
  return HEAT_WORD.test(hot) && ELECTRICAL_THING.test(hot);
}

const JOB_PATTERNS: [JobKey, RegExp][] = [
  ['ev_charger', /\b(ev|electric vehicle|car) ?(charger|charging|charge point|wallbox)|wall ?box|charging point\b/],
  ['alarms', /\b(smoke|fire|co|carbon monoxide) (alarm|alarms|detector|detectors)\b|\balarms?\b/],
  ['panel', /\b(fuse ?box|consumer unit|switch ?board|breaker (box|panel)|electrical panel|panel upgrade|upgrade (my |the |our )?(panel|fuse ?box))\b|\bpanel\b/],
  ['rewire', /\b(re-?wir\w*|old wiring|knob and tube|aluminum wiring|aluminium wiring|new wiring)\b/],
  ['inspection', /\b(inspect\w*|certificate|eicr|safety check|test and inspect|landlord (check|certificate|safety)|electrical report)\b/],
  [
    'power_problem',
    /\b(no power|power (is |has |keeps |just )?(out|off|cut|gone|failed|tripping)|lost (all )?power|power ?cut|outage|blackout|trip(s|ped|ping)?|breaker|fuse (blew|blown|keeps)|half (the|my|our) (house|home|place)|dead (outlet|socket)s?|flickering|lights? keep(s)? (going out|flickering))\b/
  ],
  ['lighting', /\b(lights?|lighting|downlights?|spotlights?|lamp ?posts?|chandeliers?|dimmers?|led|pendants?|fixtures?|floodlights?)\b/],
  ['outlets', /\b(outlets?|sockets?|plug ?points?|power ?points?|receptacles?|switch(es)?|gfci|usb)\b/]
];

export function detectJob(text: string): JobKey | undefined {
  const t = norm(text);
  for (const [key, re] of JOB_PATTERNS) if (re.test(t)) return key;
  return undefined;
}

export function detectUrgency(text: string): Urgency | undefined {
  const t = norm(text).replace(/\bnot (right |just )?now\b/g, ' ');
  if (/\b(not urgent|no rush|not in a rush|no hurry|flexible|whenever|when convenient|at some point|planning|next month|in a few weeks|no deadline|just (getting|looking))\b/.test(t))
    return 'flexible';
  if (/\b(next week|couple of weeks|in a week)\b/.test(t)) return 'flexible';
  if (/\b(today|tonight|right now|right away|asap|as soon as possible|immediately|urgent(ly)?|this (morning|afternoon|evening)|emergency|now)\b/.test(t))
    return 'today';
  if (/\b(tomorrow|this week|few days|couple of days|next day or two|soon|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this weekend)\b/.test(t))
    return 'this_week';
  return undefined;
}

export function detectArea(text: string, config: BusinessConfig): { name: string } | undefined {
  // "I'm not in Oakfield" does not place the job in Oakfield.
  const t = norm(text).replace(/\b(?:not|isn't|aren't|outside|other than|rather than) (?:in |at |near |from |around |of )?[a-z'-]+(?: [a-z'-]+)?/g, ' ');
  for (const a of config.areas) {
    const names = [a.name, ...(a.aliases ?? [])].map(norm);
    if (names.some((n) => new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`).test(t)))
      return { name: a.name };
  }
  return undefined;
}

export function detectEmail(text: string): string | undefined {
  const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : undefined;
}

export function detectPhone(text: string): string | undefined {
  const withoutEmail = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ');
  const m = withoutEmail.match(/\+?\(?\d[\d\s().-]{5,}\d/);
  if (!m) return undefined;
  const digits = m[0].replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined;
  return m[0].trim();
}

const NOT_NAMES = new Set(
  'hi hello hey yes no ok okay thanks thank please sure maybe today tomorrow tonight urgent asap soon fine good none nothing'.split(' ')
);

const NAME_STOP = new Set(
  ('a an the in at on for with to of from not no looking having need needs needing want wanting trying interested calling here there just ' +
    'also still very so really quite getting going coming asking writing contacting hoping planning thinking seeking after about by it its ' +
    'one two some any all new old your our their his her he she they we you i me my').split(' ')
);

function nameWords(raw: string, config?: BusinessConfig): string[] {
  const words = raw.split(/\s+/).filter((w) => !/^(and|my|at|in|from|the|on|for|with|calling|phone|email|number|is)$/i.test(w));
  const kept: string[] = [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (NOT_NAMES.has(lw) || NAME_STOP.has(lw) || /ing$/.test(lw)) break;
    if (config && detectArea(w, config)) break;
    kept.push(w);
  }
  return kept;
}

export function detectName(text: string, config?: BusinessConfig): string | undefined {
  // Only phrases that clearly introduce a name. "I am looking for..." and "it's urgent" are not names.
  const explicit = text.match(
    /\b(?:my name is|my name's|name is|name's|this is|call me|name:)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){0,2})/i
  );
  const said = explicit ?? text.match(/\b(?:I am|I'm|Im)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){0,2})/);
  if (said) {
    const kept = nameWords(said[1], config);
    if (kept.length) return titleCase(kept.join(' '));
  }
  return undefined;
}

/** Bare name reply such as "Sam Rivera" when we just asked for a name. */
export function bareName(text: string): string | undefined {
  const cleaned = text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ')
    .replace(/\+?\(?\d[\d\s().-]{5,}\d/g, ' ')
    .replace(/[,;:]/g, ' ')
    .replace(/\b(and|my|number|phone|email|is|it's|its|mobile|cell)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  const words = cleaned.split(' ');
  if (words.length > 3) return undefined;
  if (!words.every((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w))) return undefined;
  if (words.some((w) => NOT_NAMES.has(w.toLowerCase()))) return undefined;
  return titleCase(cleaned);
}

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// ---- intent checks -------------------------------------------------------

export function asksPrice(text: string): boolean {
  return /\b(how much|price|prices|pricing|cost|costs|quote|quotes|estimate|ballpark|rate|rates|charge|charges|fee|fees|cheap|cheaper|expensive|afford|call-?out fee|per hour|hourly|set me back|rough numbers?|numbers for|ball ?park|what do you (run|take|charge)|what('s| is) the damage|what('s| is) it (going to |gonna )?(run|cost)|(is|are) (it|that|the \w+) free|free (to|of charge|visit|call-?out)|for free|any charge|rough (idea|figure|cost)|money)\b/.test(
    norm(text)
  );
}

export function asksAvailability(text: string): boolean {
  return /\b(available|availability|when can|when could|when are you|how soon|how quickly|how fast|how long (until|before|will it take to get)|what time|are you free|earliest|(can|could|would|will) (you|someone|somebody|he|she|they|anyone|one of you) (please )?(come|be here|make it|get here|fit me|squeeze|swing|pop|drop|stop|visit|attend|take a look|look|send|get out|come out)|when (will|would|is|are)|turnaround|lead time|wait(ing)? time|how long (is|will|would)|available (today|tonight|tomorrow|this)|(today|tonight|tomorrow|this (morning|afternoon|evening))\?|book(ing)? (me )?(in|a slot|an appointment)|any (slots|openings|appointments)|next (available|slot)|same-?day|do you have time)\b/.test(
    norm(text)
  );
}

export function asksForHuman(text: string): boolean {
  return /\b((speak|talk|chat|spoke|talking) (to|with) (a |an |the |your )?(real |actual |live )?(person|human|someone|somebody|agent|electrician|owner|manager|team|rep)|real person|actual person|live (person|agent)|a human|call me|phone me|ring me|give me a call|call back|callback|someone call)\b/.test(
    norm(text)
  );
}

export function isComplaint(text: string): boolean {
  return /\b(complain\w*|refund|angry|furious|unacceptable|ripped off|rip-?off|terrible|awful|useless|lawyer|solicitor|sue|suing|insurance claim|warranty|guarantee|previous (job|work|visit)|you (did|fitted|installed|wired|left)|still (not|isn't|hasn't|broken)|came out (last|before)|not happy|disappointed|disgusted|scam)\b/.test(
    norm(text)
  );
}

export function looksLikeQuestion(text: string): boolean {
  const t = norm(text);
  return (
    /\?/.test(t) ||
    /^(who|what|when|where|why|how|do you|does|do|can you|can i|could you|could i|are you|is it|is there|will you|would you|did|should)\b/.test(t)
  );
}

export function asksServices(text: string): boolean {
  return /\b(what (do you|kind of|types? of|services|jobs)|which services|services (do you|you)|what can you|do you (do|install|fit|offer|handle|take) [^?.]*\b(ev|charger|chargers|light|lights|lighting|outlet|outlets|socket|sockets|panel|rewire|rewiring|wiring|inspection|inspections|alarm|alarms|fuse|breaker)\b)\b/.test(norm(text));
}

export function asksAreas(text: string): boolean {
  return /\b(what areas|which areas|where do you (work|cover|operate|go|service)|do you (cover|come to|service|work in|serve)|service area|areas? (do you|you) (cover|serve|work))\b/.test(norm(text));
}

export function isGreetingOnly(text: string): boolean {
  return /^(hi|hello|hey|hiya|good (morning|afternoon|evening)|yo|hi there|hello there|anyone there|are you there)[\s!.?,]*$/.test(norm(text));
}

export function isPlaceholderName(name: string | undefined): boolean {
  if (!name) return true;
  // Chatwoot gives anonymous web visitors generated names such as "patient-snowflake-123".
  return /^[a-z]+-[a-z]+-\d+$/i.test(name.trim());
}

/** "... flexible. Priya Nair priya@example.com" -> "Priya Nair" */
export function nameBeforeContact(text: string): string | undefined {
  const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\+?\(?\d[\d\s().-]{5,}\d/);
  if (!m || m.index === undefined) return undefined;
  const head = text.slice(0, m.index);
  const n = head.match(/([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){0,2})[\s,:;-]*$/);
  if (!n) return undefined;
  const name = n[1];
  if (name.split(' ').some((w) => NOT_NAMES.has(w.toLowerCase()))) return undefined;
  return name;
}
