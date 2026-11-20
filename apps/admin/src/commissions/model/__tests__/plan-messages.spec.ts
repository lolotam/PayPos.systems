import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { DRAFT_ERROR_KEYS, PLAN_ERROR_KEYS, planServerAlerts } from '../plan-messages';

const ENGINE_CODES = [
  'INVALID_PLAN',
  'INVALID_COMBINATION',
  'INVALID_CALC',
  'INVALID_THRESHOLD',
  'MIXED_THRESHOLDS',
  'STEPS_NOT_ASCENDING',
  'NO_STEPS',
] as const;

const DRAFT_CODES = Object.keys(DRAFT_ERROR_KEYS) as Array<keyof typeof DRAFT_ERROR_KEYS>;

it.each(ENGINE_CODES)('gives the engine code %s a real message in Arabic and English', (code) => {
  const key = PLAN_ERROR_KEYS[code];
  const ar = t('ar', key);
  const en = t('en', key);
  expect(ar.length).toBeGreaterThan(0);
  expect(en.length).toBeGreaterThan(0);
  expect(ar).not.toBe(key);
  expect(en).not.toBe(key);
  expect(ar).not.toBe(en);
});

it.each(DRAFT_CODES)('gives the field-reading code %s a real message in both languages', (code) => {
  const key = DRAFT_ERROR_KEYS[code];
  const ar = t('ar', key);
  const en = t('en', key);
  expect(ar.length).toBeGreaterThan(0);
  expect(en.length).toBeGreaterThan(0);
  expect(ar).not.toBe(key);
  expect(en).not.toBe(key);
});

it('gives the generic save failure a real message in both languages', () => {
  const ar = t('ar', 'commissionPlanBuilder.errorSaveFailed');
  const en = t('en', 'commissionPlanBuilder.errorSaveFailed');
  expect(ar.length).toBeGreaterThan(0);
  expect(en.length).toBeGreaterThan(0);
  expect(ar).not.toBe(en);
});

it('sends an inherited details code like constructor to the generic save-failed message on the form', () => {
  const alerts = planServerAlerts(
    { code: 'COMMISSION_PLAN_INVALID', details: { code: 'constructor' } },
    null,
    'en',
  );
  expect(alerts.form).toBe(t('en', 'commissionPlanBuilder.errorSaveFailed'));
  expect(alerts.base).toBeNull();
  expect(alerts.tiers).toBeNull();
  expect(alerts.packageSale).toBeNull();
});
