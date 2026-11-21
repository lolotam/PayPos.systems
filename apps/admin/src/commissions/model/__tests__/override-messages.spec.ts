import { expect, it } from 'vitest';
import { t } from '@pospay/i18n';
import { OVERRIDE_FIELD_ERROR_KEYS, overrideServerAlerts } from '../override-messages';

it('puts a start date in the past under the date field', () => {
  const refusal = { code: 'COMMISSION_EFFECTIVE_FROM_PAST' };
  expect(overrideServerAlerts(refusal, 'ar')).toEqual({
    effectiveFrom: t('ar', 'errors.COMMISSION_EFFECTIVE_FROM_PAST'),
    form: null,
  });
  expect(overrideServerAlerts(refusal, 'en')).toEqual({
    effectiveFrom: t('en', 'errors.COMMISSION_EFFECTIVE_FROM_PAST'),
    form: null,
  });
});

it('puts the known refusal codes on the form', () => {
  expect(overrideServerAlerts({ code: 'SERVICE_NOT_FOUND' }, 'ar').form).toBe(
    t('ar', 'errors.SERVICE_NOT_FOUND'),
  );
  expect(overrideServerAlerts({ code: 'COMMISSION_PERIOD_CLOSED' }, 'en').form).toBe(
    t('en', 'errors.COMMISSION_PERIOD_CLOSED'),
  );
  expect(overrideServerAlerts({ code: 'FEATURE_DISABLED' }, 'en').form).toBe(
    t('en', 'errors.FEATURE_DISABLED'),
  );
});

it('falls back to the envelope message for a code it does not know', () => {
  const refusal = { code: 'SOMETHING_ELSE', message_ar: 'رفض', message_en: 'Refused' };
  expect(overrideServerAlerts(refusal, 'ar').form).toBe('رفض');
  expect(overrideServerAlerts(refusal, 'en').form).toBe('Refused');
});

it('gives every field error code a message in both languages', () => {
  for (const code of ['INVALID_DATE', 'INVALID_BPS', 'INVALID_MONEY'] as const) {
    expect(t('ar', OVERRIDE_FIELD_ERROR_KEYS[code]).trim()).not.toBe('');
    expect(t('en', OVERRIDE_FIELD_ERROR_KEYS[code]).trim()).not.toBe('');
  }
});
