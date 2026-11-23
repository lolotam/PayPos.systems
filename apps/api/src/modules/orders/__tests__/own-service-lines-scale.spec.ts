import { describe } from 'vitest';
import { perfSuite } from './own-service-lines.perf.ts';

// تجربة واحدة بحجم أكبر (قرار المدير 2026-11-22): نحو 66,000 سطر للمستأجر الهدف بنفس 600 زيارة/602 سطراً لها.
// خارج التشغيل العادي: لا تعمل إلا بالمتغير POSPAY_57_2B_SCALE=1. الحكم نفسه: مجموع Execution Time في PostgreSQL لكل صفحة < 200ms
// لكل عينة (قرار المالك 2026-11-23)؛ الزمن الكلي شاملاً السائق تشخيص فقط.
describe.skipIf(process.env['POSPAY_57_2B_SCALE'] !== '1')(
  '57-2b scaled run (~66,000 lines)',
  () => {
    perfSuite({ colleagues: 65_400, warm: 5, background: 3000, timing: true });
  },
);
