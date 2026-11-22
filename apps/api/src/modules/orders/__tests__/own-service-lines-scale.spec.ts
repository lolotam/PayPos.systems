import { describe } from 'vitest';
import { perfSuite } from './own-service-lines.perf.ts';

// تجربة واحدة بحجم أكبر (قرار المدير 2026-11-22): نحو 66,000 سطر للمستأجر الهدف بنفس 600 زيارة/602 سطراً لها.
// خارج التشغيل العادي: لا تعمل إلا بالمتغير POSPAY_57_2B_SCALE=1.
describe.skipIf(process.env['POSPAY_57_2B_SCALE'] !== '1')(
  '57-2b scaled run (~66,000 lines)',
  () => {
    perfSuite({ colleagues: 65_400, warm: 5, background: 3000 });
  },
);
