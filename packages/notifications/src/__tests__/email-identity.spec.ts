import { expect, it } from 'vitest';
import { canonicalEmail, createEmailIdentity } from '../email-identity.ts';
import { createPhoneIdentity } from '../phone-identity.ts';
import { readEmailConfiguration } from '../email-configuration.ts';

const key = 'synthetic-shared-identity-fixture'.repeat(2);
it('keeps local-part case, canonicalizes domain and rejects unsupported/ambiguous addresses', () => {
  expect(canonicalEmail('Owner@EXAMPLE.INVALID')).toBe('Owner@example.invalid');
  for (const value of [
    ' owner@example.invalid',
    'owner@example.invalid\n',
    'a..b@example.invalid',
    'a@example.invalid,b@example.invalid',
    'a@-bad.invalid',
    '"owner"@example.invalid',
    'مالك@example.invalid',
  ])
    expect(canonicalEmail(value)).toBeNull();
});
it('has its own stable keyed hash and no phone suffix', () => {
  const first = createEmailIdentity(key, 'email-v1');
  const second = createEmailIdentity(key, 'email-v1');
  const identity = first.identify('Owner@example.invalid');
  expect(identity).toEqual(second.identify('Owner@example.invalid'));
  expect(identity.hash).not.toEqual(
    createPhoneIdentity(key, 'email-v1').identify('Owner@example.invalid').hash,
  );
  expect(identity.last3).toBe('');
  expect(first.matches('Owner@example.invalid', identity)).toBe(true);
  expect(first.matches('owner@example.invalid', identity)).toBe(false);
  expect(first.matches('Owner@EXAMPLE.INVALID', identity)).toBe(false);
  expect(first.matches('Owner@example.invalid', { ...identity, hashKeyId: 'other' })).toBe(false);
});
it('empty or populated provider settings can never enable live email', () => {
  for (const env of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', EMAIL_ENABLED: 'true', RESEND_API_KEY: 'synthetic-test-only' },
  ])
    expect(readEmailConfiguration(env)).toMatchObject({
      enabled: false,
      reason: 'EMAIL_FEEDBACK_NOT_IMPLEMENTED',
    });
});
