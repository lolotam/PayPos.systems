import { createHash } from 'node:crypto';

import type { RatingTokenHash } from '../ports/rating-token-hash.port.ts';

/**
 * بيحسب بصمة SHA-256 من `node:crypto`؛ الـ domain والـ use case ما بيستوردوش crypto،
 * فالمحوّل هو الواجهة الوحيد بينهم وبين المكتبة.
 *
 * @returns منفذ تجزئة SHA-256
 */
export function ratingTokenHash(): RatingTokenHash {
  return {
    sha256: (token) => createHash('sha256').update(token, 'utf8').digest(),
  };
}
