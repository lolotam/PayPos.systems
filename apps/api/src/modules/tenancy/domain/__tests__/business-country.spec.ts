import { describe, expect, it } from 'vitest';

import { planBusinessCountryChange, storedBusinessCountry } from '../business-country.ts';

describe('storedBusinessCountry', () => {
  it('reads each of the six accepted codes as set', () => {
    for (const code of ['KW', 'SA', 'AE', 'BH', 'QA', 'OM'])
      expect(storedBusinessCountry({ country: code })).toBe(code);
  });

  it('reads an absent key, a non-string, and a malformed value as unset', () => {
    expect(storedBusinessCountry({})).toBeNull();
    expect(storedBusinessCountry({ country: 965 })).toBeNull();
    expect(storedBusinessCountry({ country: 'EG' })).toBeNull();
    expect(storedBusinessCountry({ country: { code: 'KW' } })).toBeNull();
    expect(storedBusinessCountry(null)).toBeNull();
  });

  it('keeps the other settings keys out of the decision', () => {
    expect(storedBusinessCountry({ currency: 'KWD', timezone: 'Asia/Kuwait' })).toBeNull();
    expect(storedBusinessCountry({ modules: ['pos'], country: 'QA' })).toBe('QA');
  });
});

describe('planBusinessCountryChange', () => {
  it('changes a set country to a different accepted one and audits both values', () => {
    expect(planBusinessCountryChange({ country: 'KW' }, 'SA')).toEqual({
      changed: true,
      before: 'KW',
    });
  });

  it('keeps the same value a no-op with the prior value for the audit', () => {
    expect(planBusinessCountryChange({ country: 'KW' }, 'KW')).toEqual({
      changed: false,
      before: 'KW',
    });
  });

  it('sets a country on an unset business and audits the before value as unset', () => {
    expect(planBusinessCountryChange({}, 'KW')).toEqual({ changed: true, before: null });
    expect(planBusinessCountryChange(null, 'OM')).toEqual({ changed: true, before: null });
  });

  it('treats a stored invalid value as unset for the decision and the audit alike', () => {
    expect(planBusinessCountryChange({ country: 'EG' }, 'BH')).toEqual({
      changed: true,
      before: null,
    });
    expect(planBusinessCountryChange({ country: 965 }, 'BH')).toEqual({
      changed: true,
      before: null,
    });
  });
});
