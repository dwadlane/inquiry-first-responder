import { sampleBusiness } from '../engine/config.js';
import { ChatwootClient, DryRunClient } from './chatwoot.js';
import { ClaudeDrafter, rulesDrafter } from './drafter.js';
import { createFirstResponder } from './server.js';

const env = process.env;
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

const api = env.CHATWOOT_BASE_URL && env.CHATWOOT_BOT_TOKEN
  ? new ChatwootClient({ baseUrl: env.CHATWOOT_BASE_URL, token: env.CHATWOOT_BOT_TOKEN })
  : new DryRunClient(log);
if (api instanceof DryRunClient) log('No CHATWOOT_BASE_URL and CHATWOOT_BOT_TOKEN set. Dry run: replies are printed, not sent.');

let drafter = rulesDrafter;
if (env.FIRST_RESPONDER_DRAFTER === 'claude') {
  if (!env.ANTHROPIC_API_KEY) {
    log('FIRST_RESPONDER_DRAFTER=claude but ANTHROPIC_API_KEY is empty. Using the rule engine only.');
  } else {
    drafter = new ClaudeDrafter({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      onReject: (why) => log(`Claude draft not used (${why}). Sent the rule engine wording.`)
    });
    log('Claude drafter on. It only rewords routine questions; hand offs, safety and price wording are fixed.');
  }
}

const { server } = createFirstResponder({
  api,
  business: sampleBusiness,
  webhookSecret: env.CHATWOOT_WEBHOOK_SECRET || undefined,
  allowUnsigned: env.ALLOW_UNSIGNED === 'true',
  drafter,
  log
});
const port = Number(env.PORT ?? 3100);
server.listen(port, () => log(`Inquiry First Responder listening on :${port} (POST /webhook, GET /health)`));
