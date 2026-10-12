import type { ServiceSessionRecorded as Recorded, ServiceSessionLinesAdded as Added, ServiceLineChanged as Changed } from '@pospay/contracts';
/** يصدر مرة عند إنشاء زيارة مع بنودها المقبولة بالنسخة الأولى في نفس معاملة المال. */
export type ServiceSessionRecorded = Recorded;
/** يصدر مرة لكل إضافة ناجحة ويحمل البنود الجديدة فقط دون إعادة إصدار الزيارة أو بنودها القديمة. */
export type ServiceSessionLinesAdded = Added;
/** يصدر لاحقاً عند تغيير بند محفوظ في 35d أو 37 أو 37b مع كامل حالته ونسخة أعلى؛ لا يصدر عند التسجيل الأول. */
export type ServiceLineChanged = Changed;
