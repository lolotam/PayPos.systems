import { describe, expect, it } from 'vitest';
import {
  renderStaffPinResetEmail,
  STAFF_PIN_RESET_OTP_KEY,
  STAFF_PIN_RESET_OTP_REVISION,
} from '../templates/staff-pin-reset-otp.ts';
import { renderOperationalEmail } from '../templates/email-operational.ts';

const ORIGIN = 'https://app.pospay.systems';

describe('staff PIN recovery email', () => {
  it.each([
    ['en', 'ltr', 'PosPay PIN recovery code'],
    ['ar', 'rtl', 'رمز استعادة الرقم السري'],
  ] as const)('renders the %s email through the shared layout', (locale, dir, subject) => {
    const email = renderStaffPinResetEmail(STAFF_PIN_RESET_OTP_REVISION, locale, '123456', ORIGIN);
    expect(email?.subject).toBe(subject);
    expect(email?.html).toContain(`dir="${dir}"`);
    expect(email?.html).toContain('123456');
    expect(email?.html).toContain(`${ORIGIN}/brand/logo-mark-simple-tile.png`);
    expect(email?.text).toContain('123456');
    expect(email?.subject).not.toContain('123456');
  });

  it('does not borrow the password wording', () => {
    const email = renderStaffPinResetEmail(1, 'en', '123456', ORIGIN);
    expect(email?.html.toLowerCase()).not.toContain('password');
  });

  it.each([
    ['a short code', 1, 'en', '12345'],
    ['a non-numeric code', 1, 'en', '12345a'],
    ['an unsupported locale', 1, 'fr', '123456'],
    ['an unknown revision', 2, 'en', '123456'],
  ])('returns null for %s', (_name, revision, locale, code) => {
    expect(renderStaffPinResetEmail(revision, locale, code, ORIGIN)).toBeNull();
  });

  it('is reachable through the operational renderer by its own key only', () => {
    expect(
      renderOperationalEmail(STAFF_PIN_RESET_OTP_KEY, 1, 'en', ['123456'], ORIGIN),
    ).not.toBeNull();
    expect(renderOperationalEmail(STAFF_PIN_RESET_OTP_KEY, 1, 'en', [], ORIGIN)).toBeNull();
  });
});
