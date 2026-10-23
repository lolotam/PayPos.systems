import { createHash } from 'node:crypto';
import type { TermsHashPort } from '../ports/discount-request.port.ts';

/**
 * يجيب بصمة الشروط من `node:crypto`؛ الـ domain ما يستوردش crypto، فالمحوّل هو الواجهة الوحيد بينهما.
 *
 * @returns منفذ تجزئة SHA-256 hexadecimal
 */
export function termsHash(): TermsHashPort {
  return {
    sha256Hex: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}
