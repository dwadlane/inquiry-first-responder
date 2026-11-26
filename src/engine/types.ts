export type JobKey =
  | 'power_problem'
  | 'outlets'
  | 'lighting'
  | 'ev_charger'
  | 'panel'
  | 'rewire'
  | 'alarms'
  | 'inspection';

export type Urgency = 'emergency' | 'today' | 'this_week' | 'flexible';

export interface Slots {
  jobType?: JobKey;
  /** What the customer said the job is, in their words (trimmed). */
  details?: string;
  area?: string;
  /** true when the area matches the business's listed service areas. */
  areaListed?: boolean;
  urgency?: Urgency;
  name?: string;
  phone?: string;
  email?: string;
}

export type FlagKind =
  | 'emergency'
  | 'price_question'
  | 'availability_question'
  | 'human_request'
  | 'complaint'
  | 'unanswered_question'
  | 'area_not_listed'
  | 'unclear'
  | 'attachment';

export interface Flag {
  kind: FlagKind;
  text?: string;
}

export interface TranscriptLine {
  from: 'customer' | 'bot';
  text: string;
}

export interface ConversationState {
  stage: 'collecting' | 'handed_off';
  slots: Slots;
  flags: Flag[];
  /** Number of turns in a row the bot could not make sense of. */
  unclear: number;
  turns: number;
  /** Turns in a row where nothing new was learned. */
  stalled?: number;
  /** Milliseconds since epoch when the handoff finished. Set by the server, not the engine. */
  handedOffAt?: number;
  transcript: TranscriptLine[];
}

export interface Handoff {
  /** One plain sentence for the person taking over. */
  reason: string;
  urgent: boolean;
  /** Private note text for the team. */
  summary: string;
  labels: string[];
}

export interface StepResult {
  state: ConversationState;
  /** Text to send to the customer. Empty when the bot stays silent. */
  reply: string;
  handoff?: Handoff;
  /**
   * Replies that contain safety wording or hard facts. Drafters must never
   * reword these.
   */
  locked: boolean;
}

export interface BusinessConfig {
  /** Fictional in this demo. */
  name: string;
  botName: string;
  /** Short line for each job type the business takes. */
  services: Record<JobKey, string>;
  /** Areas the business lists as served, with optional alternate spellings. */
  areas: { name: string; aliases?: string[] }[];
  /** What the customer should do in a real emergency. */
  emergencyAdvice: string;
}

export interface StepOptions {
  /** Contact details already known from the chat channel (Chatwoot contact). */
  knownContact?: { name?: string; phone?: string; email?: string };
  /** Number of attachments on this message. */
  attachments?: number;
}
