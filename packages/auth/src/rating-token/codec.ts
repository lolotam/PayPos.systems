import { createHash, createHmac } from 'node:crypto';
import type { RatingTokenKeyRing } from './configuration.ts';
import { assertRatingTokenIdentity, type RatingTokenIdentity } from './identity.ts';

export interface RatingTokenClaim {
  readonly tokenHash: Uint8Array;
  readonly keyVersion: number;
}

export interface RatingTokenClaimCodec {
  /** يعيد بصمة الرابط وإصدار مفتاحه حتى لا يحتاج مسار التخزين إلى النص الأصلي. */
  claim(identity: RatingTokenIdentity): RatingTokenClaim;
}

export interface RatingTokenSenderCodec {
  /** يعيد الرابط بإصدار المفتاح المحفوظ، أو null عندما لا يكون متاحاً في الحلقة. */
  token(identity: RatingTokenIdentity, keyVersion: number): string | null;
}

/**
 * يفصل قدرة تخزين البصمة عن قدرة إرسال الرابط حتى لا يتسرب النص إلى جانب الـ claim.
 *
 * @param ring المفاتيح الحالية والمتقاعدة التي يملكها الـ worker
 * @returns كائنان مستقلان للـ claim والـ sender يستخدمان اشتقاقاً واحداً
 */
export function createRatingTokenCodecs(ring: RatingTokenKeyRing): {
  readonly claim: RatingTokenClaimCodec;
  readonly sender: RatingTokenSenderCodec;
} {
  const claim: RatingTokenClaimCodec = {
    claim(identity) {
      assertRatingTokenIdentity(identity);
      const token = deriveToken(ring, identity, ring.currentVersion);
      return {
        tokenHash: createHash('sha256').update(token, 'utf8').digest(),
        keyVersion: ring.currentVersion,
      };
    },
  };
  const sender: RatingTokenSenderCodec = {
    token(identity, keyVersion) {
      assertRatingTokenIdentity(identity);
      if (
        !Number.isInteger(keyVersion) ||
        keyVersion < 1 ||
        keyVersion > 32767 ||
        !ring.keys.has(keyVersion)
      )
        return null;
      return deriveToken(ring, identity, keyVersion);
    },
  };
  return { claim, sender };
}

function deriveToken(
  ring: RatingTokenKeyRing,
  identity: RatingTokenIdentity,
  keyVersion: number,
): string {
  const key = ring.keys.get(keyVersion);
  if (key === undefined) throw new Error('RATING_TOKEN_KEY_UNAVAILABLE');
  const context = encode([
    'pospay:rating-token:derive:v1',
    String(keyVersion),
    identity.companyId,
    identity.ratingRequestId,
  ]);
  const random = createHmac('sha256', key).update(context).digest();
  return `${identity.companyId}.${random.toString('base64url')}`;
}

function encode(parts: readonly string[]): Buffer {
  return Buffer.concat(
    parts.map((part) => {
      const value = Buffer.from(part, 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(value.length);
      return Buffer.concat([length, value]);
    }),
  );
}
