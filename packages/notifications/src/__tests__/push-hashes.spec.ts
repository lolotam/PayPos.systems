import { describe, expect, it } from 'vitest';

import { endpointHash, installationHash, subscriberRef, vapidKeyId } from '../push/hashes.js';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const OTHER_COMPANY = '01920000-0000-7000-8000-0000000000b0';
const INSTALLATION = '01920000-0000-4000-8000-0000000000c1';
const HEX = /^[0-9a-f]+$/;

describe('installationHash', () => {
  it('is a 32 byte digest that is stable for the same tuple', () => {
    const hash = installationHash(COMPANY, INSTALLATION);
    expect(hash).toHaveLength(32);
    expect(hash.toString('hex')).toMatch(HEX);
    expect(installationHash(COMPANY, INSTALLATION).equals(hash)).toBe(true);
  });

  it('separates two companies and two tags for the same install', () => {
    const here = installationHash(COMPANY, INSTALLATION);
    expect(installationHash(OTHER_COMPANY, INSTALLATION).equals(here)).toBe(false);
    expect(installationHash(COMPANY.toUpperCase(), INSTALLATION.toUpperCase()).equals(here)).toBe(
      true,
    );
  });
});

describe('endpointHash', () => {
  it('is a 32 byte digest over the endpoint bytes and is stable', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic';
    const hash = endpointHash(endpoint);
    expect(hash).toHaveLength(32);
    expect(endpointHash(endpoint).equals(hash)).toBe(true);
    expect(endpointHash(`${endpoint}-other`).equals(hash)).toBe(false);
  });
});

describe('subscriberRef', () => {
  it('is 64 lowercase hex characters, equal for one person and different for two', () => {
    const ref = subscriberRef('01920000-0000-7000-8000-0000000000f1');
    expect(ref).toHaveLength(64);
    expect(ref).toMatch(HEX);
    expect(subscriberRef('01920000-0000-7000-8000-0000000000F1')).toBe(ref);
    expect(subscriberRef('01920000-0000-7000-8000-0000000000f2')).not.toBe(ref);
  });
});

describe('vapidKeyId', () => {
  it('is the first 16 hex characters of the digest and is stable', () => {
    const key = 'BPublicKey';
    const id = vapidKeyId(key);
    expect(id).toHaveLength(16);
    expect(id).toMatch(HEX);
    expect(vapidKeyId(key)).toBe(id);
    expect(vapidKeyId('BPublicKey2')).not.toBe(id);
  });
});
