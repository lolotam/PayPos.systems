import { describe, expect, it } from 'vitest';

import { readPushApiConfiguration } from '../push/configuration.js';
import { vapidKeyId } from '../push/hashes.js';

const publicKey = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString('base64url');
const otherKey = Buffer.concat([Buffer.from([0x03]), Buffer.alloc(64, 7)]).toString('base64url');

const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

describe('readPushApiConfiguration', () => {
  it('reads a valid public key and a valid subject', () => {
    const configuration = readPushApiConfiguration(
      env({ VAPID_PUBLIC_KEY: publicKey, VAPID_SUBJECT: 'mailto:ops@pospay.systems' }),
    );
    expect(configuration).not.toBeNull();
    expect(configuration?.publicKey).toBe(publicKey);
    expect(configuration?.keyId).toBe(vapidKeyId(publicKey));
    expect(configuration?.subject).toBe('mailto:ops@pospay.systems');
  });

  it('accepts an https subject', () => {
    expect(
      readPushApiConfiguration(
        env({ VAPID_PUBLIC_KEY: publicKey, VAPID_SUBJECT: 'https://pospay.systems/push' }),
      ),
    ).not.toBeNull();
  });

  it('is not ready when either variable is missing', () => {
    expect(readPushApiConfiguration(env({}))).toBeNull();
    expect(readPushApiConfiguration(env({ VAPID_PUBLIC_KEY: publicKey }))).toBeNull();
    expect(readPushApiConfiguration(env({ VAPID_SUBJECT: 'mailto:ops@pospay.systems' }))).toBeNull();
  });

  it('is not ready for a public key that is not a P-256 point', () => {
    for (const key of [otherKey, 'not-base64url!!', publicKey.slice(0, 80), '']) {
      expect(
        readPushApiConfiguration(env({ VAPID_PUBLIC_KEY: key, VAPID_SUBJECT: 'mailto:a@b.test' })),
        key,
      ).toBeNull();
    }
  });

  it('is not ready for a subject that is not a mailto address or an https url', () => {
    for (const subject of [
      'ops@pospay.systems',
      'mailto:ops',
      'mailto:ops@pospay@systems',
      'http://pospay.systems/push',
      'mailto:',
      '',
    ]) {
      expect(
        readPushApiConfiguration(env({ VAPID_PUBLIC_KEY: publicKey, VAPID_SUBJECT: subject })),
        subject,
      ).toBeNull();
    }
  });

  it('never throws on a broken environment', () => {
    expect(() =>
      readPushApiConfiguration(env({ VAPID_PUBLIC_KEY: 'x', VAPID_SUBJECT: 'y' })),
    ).not.toThrow();
  });
});
