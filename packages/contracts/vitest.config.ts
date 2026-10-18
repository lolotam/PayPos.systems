import { defineConfig } from 'vitest/config';

// الاختبارات هنا بتفترض سلوك المتصفح (الرد بيشيل المفتاح الزيادة) حتى لو الـ shell مصدّر POSPAY_STRICT_RESPONSES.
export default defineConfig({
  test: { env: { POSPAY_STRICT_RESPONSES: '0' } },
});
