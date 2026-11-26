import type { BusinessConfig } from './types.js';

/**
 * Sample business for the demo. Brightline Electric is fictional.
 * The area names are made up and do not point to a real place.
 */
export const sampleBusiness: BusinessConfig = {
  name: 'Brightline Electric',
  botName: 'the Brightline Electric assistant',
  services: {
    power_problem: 'power loss or a tripping breaker',
    outlets: 'outlets and switches',
    lighting: 'lighting',
    ev_charger: 'an EV charger install',
    panel: 'a fuse box or panel upgrade',
    rewire: 'rewiring',
    alarms: 'smoke alarms',
    inspection: 'an electrical safety inspection'
  },
  areas: [
    { name: 'Oakfield' },
    { name: 'Harbor Point', aliases: ['harbour point'] },
    { name: 'Cedar Heights' },
    { name: 'Westbrook' },
    { name: 'Maple Ridge' }
  ],
  emergencyAdvice:
    'If anyone is hurt, or there is fire or heavy smoke, leave the building and call your local emergency number now. If it is safe to do so, switch off the power at the main switch and keep away from the area.'
};
