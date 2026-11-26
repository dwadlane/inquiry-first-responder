import { describe, expect, it } from 'vitest';
import { isEmergency } from '../src/engine/extract';

describe('downed lines', () => {
  it('treats a downed line as an emergency', () => {
    expect(isEmergency('power line down in my yard')).toBe(true);
    expect(isEmergency('a fallen wire on the driveway')).toBe(true);
  });

  it('leaves ordinary wiring requests alone', () => {
    expect(isEmergency('I need a new power line run to the shed')).toBe(false);
  });
});
