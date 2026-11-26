import { flagLine, newState, sampleBusiness, step, URGENCY_LABEL, type ConversationState } from '../src/engine/index.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $('log'), form = $<HTMLFormElement>('composer'), input = $<HTMLInputElement>('msg');
const sendBtn = $<HTMLButtonElement>('send');
const status = $('status'), flagsEl = $('flags'), note = $('note'), noteText = $('note-text');
const actions = $('actions'), actionsList = $('actions-list'), empty = $('empty');

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

const SAMPLES = [
  'Half my house lost power',
  'How much for an EV charger in Westbrook?',
  'I can smell burning from an outlet',
  'New downlights in Springfield, this week',
  'Can I speak to a real person?',
  'Do you work with solar batteries?'
];

let state: ConversationState = newState();
let busy = false;

function bubble(kind: 'bot' | 'me' | 'sys', text: string) {
  const d = document.createElement('div');
  d.className = `msg ${kind}`;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

function typing() {
  const d = document.createElement('div');
  d.className = 'msg bot typing';
  d.setAttribute('aria-label', 'The assistant is typing');
  d.innerHTML = '<i></i><i></i><i></i>';
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

function setSlot(slot: string, value: string | undefined) {
  const li = document.querySelector(`[data-slot="${slot}"]`) as HTMLElement;
  li.classList.toggle('done', Boolean(value));
  (li.querySelector('.v') as HTMLElement).textContent = value ?? 'Waiting';
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function render() {
  const s = state.slots;
  setSlot('job', s.jobType ? cap(sampleBusiness.services[s.jobType]) : undefined);
  setSlot('area', s.area ? s.area + (s.areaListed ? '' : ' (not on the service list)') : undefined);
  setSlot('urgency', s.urgency ? URGENCY_LABEL[s.urgency] : undefined);
  const contact = [s.name, s.phone, s.email].filter(Boolean).join(', ');
  setSlot('contact', contact || undefined);

  flagsEl.replaceChildren(
    ...state.flags.map((f) => {
      const li = document.createElement('li');
      li.textContent = flagLine(f) ?? '';
      return li;
    })
  );
  empty.hidden = state.turns > 0;
}

function showHandoff(result: ReturnType<typeof step>) {
  const h = result.handoff!;
  status.dataset.state = h.urgent ? 'urgent' : 'handoff';
  status.textContent = state.slots.urgency === 'emergency' ? 'Urgent, with a person' : 'Handed to a person';
  noteText.textContent = h.summary;
  note.hidden = false;
  const steps = [
    'Sent the reply to the customer',
    'Added the private note above for your team',
    `Added labels: ${h.labels.join(', ')}`,
    'Moved the chat from Pending to Open so a person sees it'
  ];
  actionsList.replaceChildren(
    ...steps.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    })
  );
  actions.hidden = false;
}

async function send(text: string) {
  const t = text.trim();
  if (!t || busy) return;
  busy = true;
  sendBtn.disabled = true;
  bubble('me', t);
  input.value = '';
  const result = step(state, t, sampleBusiness);
  state = result.state;
  render();
  if (result.reply) {
    const dots = typing();
    await wait(650);
    dots.remove();
    bubble('bot', result.reply);
  } else {
    bubble('sys', 'A person has this chat now, so the assistant stays quiet. Your message goes to their inbox.');
  }
  if (result.handoff) {
    showHandoff(result);
    bubble('sys', 'Handed to a person. The assistant stops here.');
  }
  busy = false;
  sendBtn.disabled = false;
  input.focus({ preventScroll: true });
}

function reset() {
  state = newState();
  log.replaceChildren();
  status.dataset.state = 'bot';
  status.textContent = 'With the assistant';
  note.hidden = true;
  actions.hidden = true;
  render();
  bubble('sys', 'Sample chat. You are the customer.');
}

const chips = $('chips');
for (const text of SAMPLES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = text;
  b.addEventListener('click', () => send(text));
  chips.appendChild(b);
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  void send(input.value);
});
$('reset').addEventListener('click', reset);

// Theme and text size, kept on every page.
const root = document.documentElement;
const themeBtn = $('theme'), themeLabel = $('theme-label');
function isDark() {
  const t = root.getAttribute('data-theme');
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function syncTheme() {
  themeLabel.textContent = isDark() ? 'Light' : 'Dark';
}
themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('g2-theme', next); } catch { /* private mode */ }
  syncTheme();
});
let fs = Number(root.getAttribute('data-fs') ?? 0);
function setFs(n: number) {
  fs = Math.max(-1, Math.min(2, n));
  root.setAttribute('data-fs', String(fs));
  try { localStorage.setItem('g2-fs', String(fs)); } catch { /* private mode */ }
}
$('fs-up').addEventListener('click', () => setFs(fs + 1));
$('fs-down').addEventListener('click', () => setFs(fs - 1));

syncTheme();
reset();
