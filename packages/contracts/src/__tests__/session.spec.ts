import { describe, expect, it } from 'vitest';

import { confirmPasswordInput, loginInput, totpCodeInput } from '../identity/session.js';

describe('session contracts', () => {
  it('accepts valid email and non-empty password, rejecting invalid email or empty password', () => {
    const valid = { email: 'admin@pospay.systems', password: 'correct-horse-battery' };
    expect(loginInput.safeParse(valid).success).toBe(true);

    expect(loginInput.safeParse({ email: 'bad-email', password: 'pass' }).success).toBe(false);
    expect(loginInput.safeParse({ email: '', password: 'pass' }).success).toBe(false);
    expect(loginInput.safeParse({ email: 'admin@pospay.systems', password: '' }).success).toBe(false);
    expect(loginInput.safeParse({ ...valid, extra: 'forbidden' }).success).toBe(false);
  });

  it('accepts exactly 6 digits for TOTP and rejects any other length, letters, or spaces', () => {
    expect(totpCodeInput.safeParse({ code: '123456' }).success).toBe(true);
    expect(totpCodeInput.safeParse({ code: '000000' }).success).toBe(true);
    expect(totpCodeInput.safeParse({ code: '999999' }).success).toBe(true);

    expect(totpCodeInput.safeParse({ code: '12345' }).success).toBe(false);
    expect(totpCodeInput.safeParse({ code: '1234567' }).success).toBe(false);
    expect(totpCodeInput.safeParse({ code: '12345a' }).success).toBe(false);
    expect(totpCodeInput.safeParse({ code: 'abcdef' }).success).toBe(false);
    expect(totpCodeInput.safeParse({ code: '123 45' }).success).toBe(false);
    expect(totpCodeInput.safeParse({ code: '' }).success).toBe(false);
    expect(totpCodeInput.safeParse({ code: '123456', extra: 1 }).success).toBe(false);
  });

  it('accepts non-empty password confirmation and rejects empty', () => {
    expect(confirmPasswordInput.safeParse({ password: 'secret' }).success).toBe(true);
    expect(confirmPasswordInput.safeParse({ password: '' }).success).toBe(false);
    expect(confirmPasswordInput.safeParse({ password: 'secret', other: true }).success).toBe(false);
  });
});
