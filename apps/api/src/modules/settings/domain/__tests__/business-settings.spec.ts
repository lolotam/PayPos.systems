import { describe, expect, it } from 'vitest';

import { effectiveSettings, SETTINGS_TEMPLATE } from '../business-settings.ts';

describe('business settings: the template, then the client (Waleed 2026-09-23)', () => {
  it('a business that changed nothing gets the template: Arabic first', () => {
    expect(effectiveSettings(SETTINGS_TEMPLATE, null)).toEqual({
      limitBps: null,
      defaultLanguage: 'ar',
      calendar: 'gregorian',
      overridden: [],
    });
  });

  it("a business's own value wins, and only that key is marked as its own", () => {
    expect(
      effectiveSettings(SETTINGS_TEMPLATE, { defaultLanguage: null, calendar: 'hijri' }),
    ).toEqual({
      limitBps: null,
      defaultLanguage: 'ar',
      calendar: 'hijri',
      overridden: ['calendar'],
    });
    expect(
      effectiveSettings(SETTINGS_TEMPLATE, { defaultLanguage: 'en', calendar: 'hijri' }),
    ).toEqual({
      limitBps: null,
      defaultLanguage: 'en',
      calendar: 'hijri',
      overridden: ['default_language', 'calendar'],
    });
  });

  it('a template change reaches every business that kept the template value', () => {
    const template = { defaultLanguage: 'en', calendar: 'hijri' } as const;
    expect(effectiveSettings(template, { defaultLanguage: 'ar', calendar: null })).toEqual({
      limitBps: null,
      defaultLanguage: 'ar',
      calendar: 'hijri',
      overridden: ['default_language'],
    });
  });

  it('inherits a changed template while preserving explicit zero and resetting null', () => {
    const template = { ...SETTINGS_TEMPLATE, limitBps: 500 };
    expect(effectiveSettings(template, null).limitBps).toBe(500);
    expect(
      effectiveSettings(template, { defaultLanguage: null, calendar: null, limitBps: 0 }),
    ).toMatchObject({ limitBps: 0, overridden: ['limit_bps'] });
    expect(
      effectiveSettings(template, { defaultLanguage: null, calendar: null, limitBps: null })
        .limitBps,
    ).toBe(500);
  });
});
