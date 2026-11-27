import { expect, it } from 'vitest';
import { t } from './catalog.js';
import { passwordResetAr, passwordResetEn } from './password-reset-catalog.js';

it('supplies Arabic and English copy for every password-reset key', () => {
  for (const key of Object.keys(passwordResetEn) as (keyof typeof passwordResetEn)[]) {
    expect(t('ar', `passwordReset.${key}`)).toBe(passwordResetAr[key]);
    expect(t('en', `passwordReset.${key}`)).toBe(passwordResetEn[key]);
    expect(passwordResetAr[key]).toMatch(/[؀-ۿ]/);
    expect(passwordResetEn[key]).not.toMatch(/[؀-ۿ]/);
  }
});

it('uses the owner-given Arabic words for the entry link', () => {
  expect(passwordResetAr.link).toBe('نسيت كلمة المرور؟');
  expect(passwordResetEn.link).toBe('Forgot password?');
});

it('never tells the visitor whether the email has an account', () => {
  expect(passwordResetEn.verifyLead.startsWith('If this email belongs')).toBe(true);
  expect(passwordResetAr.verifyLead.startsWith('لو البريد ده تابع')).toBe(true);
});

it('keeps the resend countdown as one sentence with a seconds placeholder', () => {
  expect(passwordResetEn.resendWait).toContain('{seconds}');
  expect(passwordResetAr.resendWait).toContain('{seconds}');
  expect(Object.keys(passwordResetEn)).not.toContain('resendUnit');
});
