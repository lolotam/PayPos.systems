import { describe, expect, it } from 'vitest';
import {
  PASSWORD_RESET_OTP_KEY,
  PASSWORD_RESET_OTP_REVISION,
  renderPasswordResetEmail,
} from '../templates/password-reset-otp.ts';
import { renderOperationalEmail } from '../templates/email-operational.ts';

const ORIGIN = 'https://app.pospay.systems';

describe('password reset email', () => {
  it.each([
    ['en', 'ltr', 'PosPay password reset code'],
    ['ar', 'rtl', 'رمز إعادة تعيين كلمة المرور'],
  ] as const)(
    'renders the %s email through the shared layout with the code',
    (locale, dir, subject) => {
      const email = renderPasswordResetEmail(PASSWORD_RESET_OTP_REVISION, locale, '123456', ORIGIN);
      expect(email?.subject).toBe(subject);
      expect(email?.html).toContain(`dir="${dir}"`);
      expect(email?.html).toContain('123456');
      expect(email?.html).toContain(`${ORIGIN}/brand/logo-mark-simple-tile.png`);
      expect(email?.text).toContain('123456');
      expect(email?.text).toContain('10');
    },
  );

  it('never puts the code in the subject line', () => {
    const email = renderPasswordResetEmail(1, 'en', '123456', ORIGIN);
    expect(email?.subject).not.toContain('123456');
  });

  it.each([
    ['a five-digit code', 1, 'en', '12345'],
    ['a non-numeric code', 1, 'en', '12345a'],
    ['a numeric value instead of a string', 1, 'en', 123456],
    ['an unsupported locale', 1, 'fr', '123456'],
    ['an unknown revision', 2, 'en', '123456'],
  ])('returns null for %s', (_name, revision, locale, code) => {
    expect(renderPasswordResetEmail(revision, locale, code, ORIGIN)).toBeNull();
  });

  it('is reachable through the operational renderer by its key and nothing else', () => {
    expect(
      renderOperationalEmail(PASSWORD_RESET_OTP_KEY, 1, 'en', ['123456'], ORIGIN),
    ).not.toBeNull();
    expect(renderOperationalEmail('password_reset_otp', 1, 'en', [], ORIGIN)).toBeNull();
    expect(renderOperationalEmail('staff_otp', 1, 'en', ['123456'], ORIGIN)).toBeNull();
  });
});
