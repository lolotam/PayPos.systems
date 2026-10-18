import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { companyNumbersEditMessage, companyNumbersListDenied } from './company-employee-number-message';

const retry = {
  code: 'TRANSACTION_RETRY_REQUIRED',
  status: 409,
  message_en: 'Synthetic retry',
  message_ar: 'Synthetic retry ar',
};
const feature = {
  code: 'FEATURE_DISABLED',
  status: 403,
  message_en: 'Synthetic feature',
  message_ar: 'Synthetic feature ar',
};

it('shows the taken catalog text only for EMPLOYEE_NUMBER_TAKEN', () => {
  const taken = { code: 'EMPLOYEE_NUMBER_TAKEN', status: 409, message_en: 'Synthetic taken', message_ar: 'x' };
  expect(companyNumbersEditMessage(taken, 'en')).toBe(t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'));
  expect(companyNumbersEditMessage(taken, 'ar')).toBe(t('ar', 'errors.EMPLOYEE_NUMBER_TAKEN'));
  expect(companyNumbersEditMessage({ status: 409 }, 'en')).toBe(t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'));
});

it('shows a coded 409 envelope instead of the taken text', () => {
  expect(companyNumbersEditMessage(retry, 'en')).toBe('Synthetic retry');
  expect(companyNumbersEditMessage(retry, 'ar')).toBe('Synthetic retry ar');
  expect(companyNumbersEditMessage(retry, 'en')).not.toBe(t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'));
});

it('uses refusal for FORBIDDEN and an uncoded 403', () => {
  expect(companyNumbersEditMessage({ code: 'FORBIDDEN', status: 403 }, 'en')).toBe(
    t('en', 'companyEmployeeNumbers.refusal'),
  );
  expect(companyNumbersEditMessage({ status: 403 }, 'en')).toBe(t('en', 'companyEmployeeNumbers.refusal'));
});

it('shows a coded 403 envelope and does not close the list', () => {
  expect(companyNumbersEditMessage(feature, 'en')).toBe('Synthetic feature');
  expect(companyNumbersEditMessage(feature, 'en')).not.toBe(t('en', 'companyEmployeeNumbers.refusal'));
  expect(companyNumbersListDenied(feature)).toBe(false);
});

it('closes the list only for FORBIDDEN or an uncoded 403', () => {
  expect(companyNumbersListDenied({ code: 'FORBIDDEN', status: 403 })).toBe(true);
  expect(companyNumbersListDenied({ status: 403 })).toBe(true);
  expect(companyNumbersListDenied({ code: 'FEATURE_DISABLED', status: 403 })).toBe(false);
});

it('falls back to the generic error when the envelope has no messages', () => {
  expect(companyNumbersEditMessage({ code: 'TRANSACTION_RETRY_REQUIRED', status: 409 }, 'en')).toBe(
    t('en', 'admin.unexpected'),
  );
});
