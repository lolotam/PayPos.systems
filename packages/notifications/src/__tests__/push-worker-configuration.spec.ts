import { describe, expect, it } from 'vitest';

import { vapidKeyId } from '../push/hashes.ts';
import { generateVapidKeyPair } from '../push/vapid-keys.ts';
import { readPushWorkerConfiguration } from '../push/worker-configuration.ts';

const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;
const SUBJECT = 'mailto:ops@pospay.systems';
const pair = generateVapidKeyPair();
const other = generateVapidKeyPair();

describe('the worker readiness', () => {
  it('is ready with a valid pair and a subject', () => {
    const readiness = readPushWorkerConfiguration(
      env({
        VAPID_PUBLIC_KEY: pair.publicKey,
        VAPID_PRIVATE_KEY: pair.privateKey,
        VAPID_SUBJECT: SUBJECT,
      }),
    );
    expect(readiness).toEqual({
      ready: true,
      configuration: {
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
        subject: SUBJECT,
        keyId: vapidKeyId(pair.publicKey),
      },
    });
  });

  it('is not configured when nothing is set', () => {
    expect(readPushWorkerConfiguration(env({}))).toEqual({
      ready: false,
      reason: 'NOT_CONFIGURED',
    });
    expect(
      readPushWorkerConfiguration(
        env({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }),
      ),
    ).toEqual({ ready: false, reason: 'NOT_CONFIGURED' });
  });
});

describe('the public key and the subject', () => {
  it('refuses a missing subject', () => {
    expect(readPushWorkerConfiguration(env({ VAPID_PUBLIC_KEY: pair.publicKey }))).toEqual({
      ready: false,
      reason: 'PUBLIC_KEY_OR_SUBJECT_INVALID',
    });
  });

  it('refuses a subject that is not a mailto address or an https url', () => {
    expect(
      readPushWorkerConfiguration(
        env({
          VAPID_PUBLIC_KEY: pair.publicKey,
          VAPID_PRIVATE_KEY: pair.privateKey,
          VAPID_SUBJECT: 'ops@pospay.systems',
        }),
      ),
    ).toEqual({ ready: false, reason: 'PUBLIC_KEY_OR_SUBJECT_INVALID' });
  });
});

describe('the private key', () => {
  const base = { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_SUBJECT: SUBJECT };

  it('refuses a key that is not a 32 byte scalar', () => {
    for (const privateKey of [
      'AAAA',
      '!'.repeat(43),
      Buffer.alloc(32).toString('base64url'),
      pair.privateKey.slice(0, 42),
    ])
      expect(
        readPushWorkerConfiguration(env({ ...base, VAPID_PRIVATE_KEY: privateKey })),
        privateKey,
      ).toEqual({ ready: false, reason: 'PRIVATE_KEY_INVALID' });
  });

  it('refuses a key that does not derive the configured public key', () => {
    expect(
      readPushWorkerConfiguration(env({ ...base, VAPID_PRIVATE_KEY: other.privateKey })),
    ).toEqual({ ready: false, reason: 'KEY_MISMATCH' });
  });

  it('never carries a key in a disabled result', () => {
    const readiness = readPushWorkerConfiguration(
      env({ ...base, VAPID_PRIVATE_KEY: other.privateKey }),
    );
    const serialized = JSON.stringify(readiness);
    expect(serialized).not.toContain(pair.publicKey);
    expect(serialized).not.toContain(other.privateKey);
  });
});
