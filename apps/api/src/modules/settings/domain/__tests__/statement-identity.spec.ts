import { describe, expect, it } from 'vitest';

import {
  statementIdentity,
  type BusinessDisplayNames,
  type StoredBusinessIdentity,
} from '../statement-identity.ts';

const LOGO = '01920000-0000-7000-8000-000000000004';

function identity(patch: Partial<StoredBusinessIdentity> = {}): StoredBusinessIdentity {
  return {
    official_name_ar: null,
    official_name_en: null,
    logo_file_id: null,
    ...patch,
  };
}

const display: BusinessDisplayNames = { name_ar: 'عرض', name_en: 'Display' };

describe('statementIdentity', () => {
  it('prefers the official name in the requested language', () => {
    const stored = identity({ official_name_ar: 'رسمي', official_name_en: 'Official' });
    expect(statementIdentity('ar', stored, display)).toEqual({
      header_name: 'رسمي',
      has_logo: false,
    });
    expect(statementIdentity('en', stored, display).header_name).toBe('Official');
  });

  it('falls through official, then display, and skips a blank name', () => {
    expect(
      statementIdentity(
        'ar',
        identity({ official_name_ar: '   ', official_name_en: 'Official' }),
        display,
      ).header_name,
    ).toBe('Official');
    expect(
      statementIdentity('en', identity({ official_name_ar: 'رسمي' }), display).header_name,
    ).toBe('رسمي');
    expect(statementIdentity('ar', identity(), display).header_name).toBe('عرض');
    expect(
      statementIdentity('en', identity(), { name_ar: 'عرض', name_en: '   ' }).header_name,
    ).toBe('عرض');
    expect(
      statementIdentity('ar', identity(), { name_ar: null, name_en: 'Display' }).header_name,
    ).toBe('Display');
    expect(
      statementIdentity('en', identity(), { name_ar: 'عرض', name_en: 'Display' }).header_name,
    ).toBe('Display');
  });

  it('reports a stored logo id without changing the header', () => {
    const stored = identity({ official_name_en: 'Official', logo_file_id: LOGO });
    expect(statementIdentity('en', stored, display)).toEqual({
      header_name: 'Official',
      has_logo: true,
    });
    expect(statementIdentity('ar', identity({ logo_file_id: LOGO }), display).has_logo).toBe(true);
  });
});
