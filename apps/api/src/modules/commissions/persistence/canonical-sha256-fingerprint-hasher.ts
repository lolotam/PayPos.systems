import { createHash } from 'node:crypto';

import { canonicalJson } from '@pospay/db';

import type { FingerprintHasher } from '../ports/fingerprint-hasher.port.ts';

/**
 * يجزّئ القيمة بـ SHA-256 على تسلسلها الثابت `canonicalJson`. أي قيمة مش JSON (bigint، دالة، رقم
 * مش محدود) بيرمي `TypeError` بدل ما تتحوّل بصمت، فتسرّب مبلغ خام لمدخل البصمة بيفشل بصوت عالي.
 */
export class CanonicalSha256FingerprintHasher implements FingerprintHasher {
  /**
   * @param value القيمة المنظمة من الباني النقي
   * @returns البصمة بطول 64 حرف hex صغير
   */
  hash(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
  }
}
