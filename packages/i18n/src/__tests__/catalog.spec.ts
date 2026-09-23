import { describe, expect, it } from 'vitest';

import { ar } from '../ar.js';
import { errorMessages, t } from '../catalog.js';
import { en } from '../en.js';

describe('catalogs', () => {
  it('Arabic and English have exactly the same keys, and no empty message', () => {
    for (const section of Object.keys(en) as (keyof typeof en)[]) {
      expect(Object.keys(ar[section]).sort()).toEqual(Object.keys(en[section]).sort());
      for (const text of [...Object.values(ar[section]), ...Object.values(en[section])]) {
        expect(text.trim()).not.toBe('');
      }
    }
  });

  it('the Arabic catalog is Arabic, and the English one is not', () => {
    for (const text of Object.values(ar.errors)) expect(text).toMatch(/[\u0600-\u06FF]/);
    for (const text of Object.values(en.errors)) expect(text).not.toMatch(/[\u0600-\u06FF]/);
  });

  it('a message by key, and an error in both languages for the envelope', () => {
    expect(t('en', 'errors.NOT_READY')).toBe('The service is not ready');
    expect(t('ar', 'errors.NOT_READY')).toBe(ar.errors.NOT_READY);
    expect(errorMessages('FORBIDDEN')).toEqual({
      message_ar: ar.errors.FORBIDDEN,
      message_en: en.errors.FORBIDDEN,
    });
  });
});
