import type { ServiceSessionRecorded as Recorded, ServiceSessionLinesAdded as Added, ServiceLineChanged as Changed, SessionTipsChanged as TipsChanged } from '@pospay/contracts';
/** يصدر مرة عند إنشاء زيارة مع بنودها المقبولة بالنسخة الأولى في نفس معاملة المال. */
export type ServiceSessionRecorded = Recorded;
/** يصدر مرة لكل إضافة ناجحة ويحمل البنود الجديدة فقط دون إعادة إصدار الزيارة أو بنودها القديمة. */
export type ServiceSessionLinesAdded = Added;
/** يصدر مرة لكل سطر عند حفظ تعديل سعر أو خصم أو إلغاء، في نفس معاملة الكتابة؛ الإلغاء يحمّل change.kind = LINE_CANCELLED. */
export type ServiceLineChanged = Changed;
/** يصدر في نفس معاملة كل مراجعة بقشيش. */
export type SessionTipsChanged = TipsChanged;
/** يصدر مرة لكل طلب موافقة خصم محفوظ، في نفس معاملة الطلب، ليصل الجرس لكل من يملك صلاحية الموافقة على الفرع ما عدا الطالبة. */
export type { DiscountApprovalRequested } from '@pospay/contracts';
