import { describe } from 'vitest';
import { perfSuite } from './own-service-lines.perf.ts';

// plan §5.3 البنود 1–3 على الحجم المعتمد: 600 زيارة/602 سطراً لها، وزميلات بعشرة أضعافها (6,020 سطراً).
// التشغيل العادي يتأكد من الصحة والخطط وعدد الاستعلامات ويسجّل العينات (الزمن الكلي وdb-time) بلا حكم زمني (AC-57-2b-9).
perfSuite({ colleagues: 6020, warm: 0, background: 1500, timing: false });

// تشغيل الأداء الصريح على نفس الحجم، ولا يعمل إلا بالمتغير POSPAY_57_2B_PERF=1. الحكم: مجموع Execution Time في PostgreSQL لجمل كل صفحة
// < 200ms لكل عينة (3 شروحات لكل صفحة) في الحالتين الإحصائيتين؛ Planning Time يُسجَّل ولا يُحكَّم به، والزمن الكلي تشخيص فقط
// (قرار المالك 2026-11-23، وقاعدة «حمل المعالج دون 40%» لم تعد شرطاً للقياس).
describe.skipIf(process.env['POSPAY_57_2B_PERF'] !== '1')(
  '57-2b explicit timing run (regular fixture)',
  () => {
    perfSuite({ colleagues: 6020, warm: 5, background: 1500, timing: true });
  },
);
