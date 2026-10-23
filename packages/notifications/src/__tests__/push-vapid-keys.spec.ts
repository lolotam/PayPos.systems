import { createECDH } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generateVapidKeyPair } from '../push/vapid-keys.ts';
import { readPushWorkerConfiguration } from '../push/worker-configuration.ts';

describe('generateVapidKeyPair', () => {
  it('gives an 87 character public key and a 43 character private key', () => {
    const pair = generateVapidKeyPair();
    expect(pair.publicKey).toHaveLength(87);
    expect(pair.privateKey).toHaveLength(43);
  });

  it('derives the public key from the private key', () => {
    const pair = generateVapidKeyPair();
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(pair.privateKey, 'base64url'));
    expect(ecdh.getPublicKey().toString('base64url')).toBe(pair.publicKey);
  });

  it('gives a different pair every time', () => {
    expect(generateVapidKeyPair().privateKey).not.toBe(generateVapidKeyPair().privateKey);
  });

  it('is accepted by the worker readiness reader', () => {
    const pair = generateVapidKeyPair();
    const readiness = readPushWorkerConfiguration({
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_SUBJECT: 'mailto:ops@pospay.systems',
    });
    expect(readiness.ready).toBe(true);
  });
});
