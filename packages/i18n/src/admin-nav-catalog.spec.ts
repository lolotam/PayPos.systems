import { describe, expect, it } from 'vitest';

import { adminNavAr, adminNavEn, schedulesAr, schedulesEn } from './admin-nav-catalog.js';
import { adminNavPagesAr } from './admin-nav-pages-ar.js';
import { adminNavPagesEn } from './admin-nav-pages-en.js';
import { t, type MessageKey } from './catalog.js';

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

describe('admin navigation & schedules catalogs', () => {
  it.each([
    { prefix: 'schedules', enMap: schedulesEn, arMap: schedulesAr },
    { prefix: 'adminNav', enMap: adminNavEn, arMap: adminNavAr },
    { prefix: 'adminNavPages', enMap: adminNavPagesEn, arMap: adminNavPagesAr },
  ])('$prefix has matching non-empty ar/en keys with expected script shape', ({ prefix, enMap, arMap }) => {
    const enKeys = Object.keys(enMap).sort();
    const arKeys = Object.keys(arMap).sort();
    expect(arKeys).toEqual(enKeys);

    for (const name of enKeys) {
      const fullKey = `${prefix}.${name}` as MessageKey;
      const enValue = t('en', fullKey);
      const arValue = t('ar', fullKey);
      expect(enValue).toBe((enMap as Record<string, string>)[name]);
      expect(arValue).toBe((arMap as Record<string, string>)[name]);
      expect(enValue.trim()).not.toBe('');
      expect(arValue.trim()).not.toBe('');
      expect(enValue).not.toMatch(ARABIC_SCRIPT);
      expect(arValue).toMatch(ARABIC_SCRIPT);
    }
  });

  it('keeps schedules.reload distinct from staff.reload in both languages', () => {
    expect(t('en', 'schedules.reload')).not.toBe(t('en', 'staff.reload'));
    expect(t('ar', 'schedules.reload')).not.toBe(t('ar', 'staff.reload'));
  });

  it('exposes the three spec-required style names in English and Arabic', () => {
    expect(t('en', 'adminNav.styleALabel')).toBe('A — Sidebar and tabs');
    expect(t('en', 'adminNav.styleBLabel')).toBe('B — Top bar and hubs');
    expect(t('en', 'adminNav.styleCLabel')).toBe('C — Rail and panel');
    expect(t('ar', 'adminNav.styleALabel')).toMatch(/^A — /);
    expect(t('ar', 'adminNav.styleBLabel')).toMatch(/^B — /);
    expect(t('ar', 'adminNav.styleCLabel')).toMatch(/^C — /);
  });

  it('keeps Under development copy free of dates and phase numbers (FR-021)', () => {
    const texts = [
      t('en', 'adminNav.underDevHeading'),
      t('en', 'adminNav.underDevBody'),
      t('ar', 'adminNav.underDevHeading'),
      t('ar', 'adminNav.underDevBody'),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/\b20\d{2}\b/);
      expect(text).not.toMatch(/phase\s*\d/i);
      expect(text).not.toMatch(/المرحلة\s*\d/);
    }
  });
});
