import type { ServiceSessionRecorded as Recorded, ServiceSessionLinesAdded as Added, ServiceLineChanged as Changed, SessionTipsChanged as TipsChanged, PackageSaleChanged as SaleChanged } from '@pospay/contracts';
/** يصدر مرة عند إنشاء زيارة مع بنودها المقبولة بالنسخة الأولى في نفس معاملة المال. */
export type ServiceSessionRecorded = Recorded;
/** يصدر مرة لكل إضافة ناجحة ويحمل البنود الجديدة فقط دون إعادة إصدار الزيارة أو بنودها القديمة. */
export type ServiceSessionLinesAdded = Added;
/** يصدر مرة لكل سطر عند حفظ تعديل سعر أو خصم أو إلغاء، في نفس معاملة الكتابة؛ الإلغاء يحمّل change.kind = LINE_CANCELLED. */
export type ServiceLineChanged = Changed;
/** يصدر في نفس معاملة كل مراجعة بقشيش. */
export type SessionTipsChanged = TipsChanged;
/** يصدر مع بيع باقة (revision = 1) ومع كل استرداد (revision + 1) في نفس المعاملة، ولا يصدر لباقة مستوردة. */
export type PackageSaleChanged = SaleChanged;
/** يصدر مرة لكل طلب موافقة خصم محفوظ، في نفس معاملة الطلب، ليصل الجرس لكل من يملك صلاحية الموافقة على الفرع ما عدا الطالبة. */
export type { DiscountApprovalRequested } from '@pospay/contracts';
/** يصدر مرة لكل قرار موافقة يكون الموافِق فيه منفّذًا لخدمة في مقترح واحد على الأقل، في نفس معاملة القرار، ليصل جرس للمالك (DA-Q3). */
export type { DiscountApprovedByPerformer } from '@pospay/contracts';
/** يُكتب مع صف pending في معاملة طلب المعاينة نفسها؛ يحمل هوية المعاينة فقط، ولا ينشره API إلى BullMQ مباشرة. */
export type { PackageImportPreviewRequested } from '@pospay/contracts';
