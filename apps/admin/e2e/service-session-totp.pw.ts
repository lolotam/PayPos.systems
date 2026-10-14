import { expect, test } from '@playwright/test';

import { totpCode } from './totp';

// RFC 6238 Appendix B: المفتاح العام المنشور للاختبار ("12345678901234567890" بـ base32)، مش سر.
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('matches the RFC 6238 SHA1 vector at unix time 59', () => {
  const at = new Date(59_000);
  expect(totpCode(secret, at, 8)).toBe('94287082');
  expect(totpCode(secret, at)).toBe('287082');
});
