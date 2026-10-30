import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRatingTokenCodecs } from './codec.ts';
import type { RatingTokenKeyRing } from './configuration.ts';
import { RatingTokenIdentityError, type RatingTokenIdentity } from './identity.ts';

const K1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const K2 = '//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA=';
const V1_TOKEN =
  '01920000-0000-7000-8000-000000000aa1.0vTCG98_ToLWpgP2Io1UPqhPnhupQiM1NPT_jzG3ZtM';
const V1_HASH = 'c5e494144058c381fe035fcf464738a744baf69bc6a3caafddfba1bea58e4bdd';
const V2_TOKEN =
  '01920000-0000-7000-8000-000000000aa1._YIkvhHVZXZWxMByacjd0IHxAfk4UsLh29UpZnIE_eM';
const V2_HASH = '450f7f567a362077a9ebbd078bfde06e25d9c94ff43b8c167f24c8604747799b';
const IDENTITY: RatingTokenIdentity = {
  companyId: '01920000-0000-7000-8000-000000000aa1',
  ratingRequestId: '01920000-0000-7000-8000-000000000bb2',
};
const SINGLE_KEY_RING: RatingTokenKeyRing = {
  currentVersion: 1,
  keys: new Map([[1, Buffer.from(K1, 'base64')]]),
};
const ROTATED_KEY_RING: RatingTokenKeyRing = {
  currentVersion: 2,
  keys: new Map([
    [1, Buffer.from(K1, 'base64')],
    [2, Buffer.from(K2, 'base64')],
  ]),
};

describe('rating token codec', () => {
  it('matches the independently pinned v1 token and claim hash', () => {
    const codecs = createRatingTokenCodecs(SINGLE_KEY_RING);
    const token = codecs.sender.token(IDENTITY, 1);
    expect(token).toBe(V1_TOKEN);
    if (token === null) throw new Error('SYNTHETIC_TOKEN_MISSING');
    const claim = codecs.claim.claim(IDENTITY);
    expect(claim.keyVersion).toBe(1);
    expect(Buffer.from(claim.tokenHash).toString('hex')).toBe(V1_HASH);
    expect(createHash('sha256').update(token, 'utf8').digest()).toEqual(claim.tokenHash);
  });

  it('emits the canonical 80-character unpadded base64url token shape', () => {
    const token = createRatingTokenCodecs(SINGLE_KEY_RING).sender.token(IDENTITY, 1);
    expect(token).not.toBeNull();
    if (token === null) throw new Error('SYNTHETIC_TOKEN_MISSING');
    expect(token).toHaveLength(80);
    expect(token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(token.slice(-1)).toMatch(/[AEIMQUYcgkosw048]/);
  });

  it('changes the derived random part when the identity fields are swapped', () => {
    const codecs = createRatingTokenCodecs(SINGLE_KEY_RING);
    const swapped = codecs.sender.token(
      { companyId: IDENTITY.ratingRequestId, ratingRequestId: IDENTITY.companyId },
      1,
    );
    expect(swapped).toBe(
      '01920000-0000-7000-8000-000000000bb2.V40e7nauPUIzcBjvgbgAhJ2Ppve8hj4js2g4gZVKbvs',
    );
    expect(swapped).not.toBe(V1_TOKEN);
  });

  it('derives the pinned v2 token for the same identity under K2', () => {
    const v2 = createRatingTokenCodecs({
      currentVersion: 2,
      keys: new Map([[2, Buffer.from(K2, 'base64')]]),
    });
    expect(v2.sender.token(IDENTITY, 2)).toBe(V2_TOKEN);
  });

  it('claims with the current v2 key while retaining the retired v1 sender key', () => {
    const codecs = createRatingTokenCodecs(ROTATED_KEY_RING);
    const claim = codecs.claim.claim(IDENTITY);
    expect(claim.keyVersion).toBe(2);
    expect(Buffer.from(claim.tokenHash).toString('hex')).toBe(V2_HASH);
    expect(codecs.sender.token(IDENTITY, 1)).toBe(V1_TOKEN);
  });

  it.each([3, 0, 32768])('returns null for unavailable or invalid key version %s', (version) => {
    expect(createRatingTokenCodecs(ROTATED_KEY_RING).sender.token(IDENTITY, version)).toBeNull();
  });

  it.each([
    ['an uppercase company id', { ...IDENTITY, companyId: IDENTITY.companyId.toUpperCase() }],
    ['a braced company id', { ...IDENTITY, companyId: `{${IDENTITY.companyId}}` }],
    ['an empty company id', { ...IDENTITY, companyId: '' }],
    [
      'an uppercase rating request id',
      { ...IDENTITY, ratingRequestId: IDENTITY.ratingRequestId.toUpperCase() },
    ],
    [
      'a braced rating request id',
      { ...IDENTITY, ratingRequestId: `{${IDENTITY.ratingRequestId}}` },
    ],
    ['an empty rating request id', { ...IDENTITY, ratingRequestId: '' }],
  ])('rejects %s on both codec sides without echoing either id', (_scenario, identity) => {
    const codecs = createRatingTokenCodecs(SINGLE_KEY_RING);
    const attempts = [
      () => codecs.claim.claim(identity),
      () => codecs.sender.token(identity, 1),
    ];
    for (const attempt of attempts) {
      let thrown: unknown;
      try {
        attempt();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RatingTokenIdentityError);
      expect(thrown).toMatchObject({ code: 'RATING_TOKEN_IDENTITY_INVALID' });
      const message = (thrown as Error).message;
      if (identity.companyId !== '') expect(message).not.toContain(identity.companyId);
      if (identity.ratingRequestId !== '')
        expect(message).not.toContain(identity.ratingRequestId);
    }
  });

  it('keeps token issuance off the claim-side object', () => {
    const codecs = createRatingTokenCodecs(SINGLE_KEY_RING);
    expect(codecs.claim).not.toHaveProperty('token');
    expect(codecs.claim).not.toBe(codecs.sender);
  });
});
