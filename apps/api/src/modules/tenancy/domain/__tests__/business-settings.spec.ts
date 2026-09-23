import { describe, expect, it } from 'vitest';

import { businessSettings } from '../business-settings.ts';

const template = { modules: ['orders', 'kitchen'], features: ['tables'] };

describe('businessSettings', () => {
  it('is the template when the request sends no settings', () => {
    expect(businessSettings(template, {})).toEqual(template);
  });

  it('lets a client key replace the same template key whole, and keeps the other template keys', () => {
    expect(businessSettings(template, { features: ['delivery'] })).toEqual({
      modules: ['orders', 'kitchen'],
      features: ['delivery'],
    });
  });

  it('adds client keys the template does not have', () => {
    expect(businessSettings(template, { receipt_footer: 'Thanks' })).toEqual({
      ...template,
      receipt_footer: 'Thanks',
    });
  });

  it('does not change either input', () => {
    const overrides = { features: [] };
    businessSettings(template, overrides);
    expect(template).toEqual({ modules: ['orders', 'kitchen'], features: ['tables'] });
    expect(overrides).toEqual({ features: [] });
  });
});
