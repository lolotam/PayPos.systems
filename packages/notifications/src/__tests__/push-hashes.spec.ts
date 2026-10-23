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

// إجابات ثابتة محسوبة بره الكود: وسم النطاق أو ترتيب البايتات لو اتغيّروا، الاختبار ده يقع.
describe('the known answers', () => {
  it('hashes the installation tuple with its domain tag', () => {
    expect(
      installationHash(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ).toString('hex'),
    ).toBe('430654adf08d5b3efa798a398399e17e41485a6a0ce1b8d74ed706424015524f');
  });

  it('hashes the endpoint bytes', () => {
    expect(endpointHash('https://fcm.googleapis.com/fcm/send/abc').toString('hex')).toBe(
      '4e9bdab8bbe7189c00aebb0922fc49fe40e00594c400f3e1b5dcf97a35c79f85',
    );
  });

  it('derives the subscriber reference from the user id', () => {
    expect(subscriberRef('33333333-3333-4333-8333-333333333333')).toBe(
      '8c33415375f448c931d0892793be1ec67dfc877cade6ebf2079976c88e2e60b8',
    );
  });

  it('derives the key id from the public key bytes', () => {
    const publicKey = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString(
      'base64url',
    );
    expect(vapidKeyId(publicKey)).toBe('2f3758f6e67f33c4');
  });
});
