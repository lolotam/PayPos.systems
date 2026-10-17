import type { ServiceSessionRecorded as Recorded, ServiceSessionLinesAdded as Added, ServiceLineChanged as Changed } from '@pospay/contracts';
import type { SessionTipsChanged as TipsChanged } from '@pospay/contracts';
/** يصدر مرة عند إنشاء زيارة مع بنودها المقبولة بالنسخة الأولى في نفس معاملة المال. */
export type ServiceSessionRecorded = Recorded;
/** يصدر مرة لكل إضافة ناجحة ويحمل البنود الجديدة فقط دون إعادة إصدار الزيارة أو بنودها القديمة. */
export type ServiceSessionLinesAdded = Added;
/** يصدر مرة لكل سطر عند حفظ تعديل سعر أو خصم، في نفس معاملة التعديل، ويحمل change الاختياري؛ 37 و37b تضيف أنواع لاحقة على نفس الحدث. */
export type ServiceLineChanged = Changed;
/** يصدر في نفس معاملة كل مراجعة بقشيش. */
export type SessionTipsChanged = TipsChanged;
