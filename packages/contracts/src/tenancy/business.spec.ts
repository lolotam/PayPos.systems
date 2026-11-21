import { describe, expect, it } from 'vitest';

import { createBusinessInput, setBusinessCountryInput } from './business.js';

describe('business country contracts (34-pre-3)', () => {
  it('accepts each of the six permitted country codes on the change request', () => {
    for (const code of ['KW', 'SA', 'AE', 'BH', 'QA', 'OM'])
      expect(setBusinessCountryInput.safeParse({ country: code }).success).toBe(true);
  });

  it('refuses codes outside the permitted six and any non-two-letter value', () => {
    for (const bad of ['EG', 'US', 'kw', 'K', 'KWW', '', 965, null])
      expect(setBusinessCountryInput.safeParse({ country: bad }).success).toBe(false);
    expect(setBusinessCountryInput.safeParse({}).success).toBe(false);
    expect(
      setBusinessCountryInput.safeParse({ country: 'KW', extra: true }).success,
    ).toBe(false);
  });

  it('reserves the country key at creation: any value, valid or not, is refused', () => {
    expect(
      createBusinessInput.safeParse({
        vertical_type: 'salon',
        name_en: 'Salon',
        settings: { country: 'KW' },
      }).success,
    ).toBe(false);
    expect(
      createBusinessInput.safeParse({
        vertical_type: 'salon',
        name_en: 'Salon',
        settings: { country: 'EG' },
      }).success,
    ).toBe(false);
    const issues = createBusinessInput.safeParse({
      vertical_type: 'salon',
      name_en: 'Salon',
      settings: { features: ['tables'], country: 'SA' },
    });
    expect(issues.success).toBe(false);
    if (!issues.success)
      expect(issues.error.issues.some((issue) => issue.path.includes('country'))).toBe(true);
  });

  it('injects no country and keeps every other settings key when the request omits it', () => {
    const parsed = createBusinessInput.safeParse({
      vertical_type: 'salon',
      name_en: 'Salon',
      settings: { features: ['tables'], custom_key: { nested: true } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('country' in parsed.data.settings).toBe(false);
      expect(parsed.data.settings).toEqual({ features: ['tables'], custom_key: { nested: true } });
    }
    const bare = createBusinessInput.safeParse({ vertical_type: 'salon', name_en: 'Salon' });
    expect(bare.success).toBe(true);
    if (bare.success) expect('country' in bare.data.settings).toBe(false);
  });
});
