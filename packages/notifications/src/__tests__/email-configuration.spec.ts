import { expect, it } from 'vitest';
import { readEmailConfiguration, type EmailDisabledReason } from '../email-configuration.ts';

const KEY = 'synthetic-email-hash-key'.repeat(2);
const KEY_ID = 'email-v1';
const API_KEY = 'synthetic-test-only';
const FULL = {
  NOTIFICATION_EMAIL_HASH_KEY: KEY,
  NOTIFICATION_EMAIL_HASH_KEY_ID: KEY_ID,
  RESEND_API_KEY: API_KEY,
  EMAIL_FROM_ADDRESS: 'synthetic@send.pospay.systems',
  EMAIL_FROM_NAME: 'Synthetic sender',
  EMAIL_REPLY_TO: 'synthetic.replies@example.invalid',
  EMAIL_ADMIN_ORIGIN: 'https://app.pospay.systems',
  PLATFORM_NOTIFICATIONS_DATABASE_URL:
    'postgres://pospay_notifications:synthetic@127.0.0.1:5432/pospay',
};

it('every missing group keeps the channel off with its own reason', () => {
  const cases: readonly [string, NodeJS.ProcessEnv, EmailDisabledReason][] = [
    [
      'hash key',
      { ...FULL, NOTIFICATION_EMAIL_HASH_KEY: 'short' },
      'EMAIL_HASH_KEY_MISSING_OR_INVALID',
    ],
    [
      'hash key id',
      { ...FULL, NOTIFICATION_EMAIL_HASH_KEY_ID: 'not a valid id' },
      'EMAIL_HASH_KEY_MISSING_OR_INVALID',
    ],
    ['provider key', { ...FULL, RESEND_API_KEY: '' }, 'RESEND_API_KEY_MISSING'],
    [
      'from address',
      { ...FULL, EMAIL_FROM_ADDRESS: 'synthetic@example.invalid' },
      'EMAIL_FROM_ADDRESS_INVALID',
    ],
    ['from name', { ...FULL, EMAIL_FROM_NAME: '   ' }, 'EMAIL_FROM_NAME_INVALID'],
    ['reply to', { ...FULL, EMAIL_REPLY_TO: 'not-an-address' }, 'EMAIL_REPLY_TO_INVALID'],
    [
      'admin origin',
      { ...FULL, EMAIL_ADMIN_ORIGIN: 'http://app.pospay.systems' },
      'EMAIL_ADMIN_ORIGIN_INVALID',
    ],
    [
      'feedback database',
      { ...FULL, PLATFORM_NOTIFICATIONS_DATABASE_URL: '' },
      'EMAIL_FEEDBACK_DB_MISSING',
    ],
  ];
  for (const [name, env, reason] of cases) {
    expect(readEmailConfiguration(env), name).toMatchObject({ enabled: false, reason });
  }
});

it('the first missing group decides the reason', () => {
  expect(
    readEmailConfiguration({ ...FULL, RESEND_API_KEY: '', EMAIL_FROM_ADDRESS: 'broken' }),
  ).toMatchObject({ enabled: false, reason: 'RESEND_API_KEY_MISSING' });
});

it('the feedback readiness closes the channel and names no secret', () => {
  const configuration = readEmailConfiguration(FULL, { feedbackReady: false });
  expect(configuration).toMatchObject({ enabled: false, reason: 'EMAIL_FEEDBACK_UNAVAILABLE' });
  expect(JSON.stringify(configuration)).not.toContain(API_KEY);
});

it('a complete configuration opens the channel with every setting', () => {
  expect(readEmailConfiguration(FULL)).toMatchObject({
    enabled: true,
    reason: null,
    hashKey: KEY,
    hashKeyId: KEY_ID,
    apiKey: API_KEY,
    fromAddress: 'synthetic@send.pospay.systems',
    fromName: 'Synthetic sender',
    replyTo: 'synthetic.replies@example.invalid',
    adminOrigin: 'https://app.pospay.systems',
  });
});

it('the sending domain and the canonical address are the only ones accepted', () => {
  expect(
    readEmailConfiguration({ ...FULL, EMAIL_FROM_ADDRESS: 'owner@send.pospay.systems' }).enabled,
  ).toBe(true);
  expect(
    readEmailConfiguration({ ...FULL, EMAIL_FROM_ADDRESS: 'owner@send.pospay.example' }).enabled,
  ).toBe(false);
  expect(
    readEmailConfiguration({ ...FULL, EMAIL_FROM_ADDRESS: 'owner@SEND.pospay.systems' }).enabled,
  ).toBe(false);
  expect(
    readEmailConfiguration({ ...FULL, EMAIL_FROM_ADDRESS: 'owner@sub.send.pospay.systems' }).enabled,
  ).toBe(false);
});

it('the disabled configuration keeps the identity but never the sending key', () => {
  const configuration = readEmailConfiguration({ ...FULL, RESEND_API_KEY: '' });
  expect(configuration).toMatchObject({ hashKey: KEY, hashKeyId: KEY_ID });
  expect(configuration.apiKey).toBeUndefined();
  expect(configuration.fromAddress).toBeUndefined();
  expect(configuration.replyTo).toBeUndefined();
});

it('the hash key stays available for the identity check even while disabled', () => {
  expect(readEmailConfiguration({})).toMatchObject({
    enabled: false,
    reason: 'EMAIL_HASH_KEY_MISSING_OR_INVALID',
  });
  expect(readEmailConfiguration({ ...FULL, RESEND_API_KEY: '' }).hashKey).toBe(KEY);
});
