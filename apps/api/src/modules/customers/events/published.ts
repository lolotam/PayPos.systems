/** يصدر مرة لكل تقييم بنجمة أو نجمتين، في نفس معاملة استهلاك الرابط وحفظ التقييم؛ aggregateType 'rating' وaggregateId هو معرّف التقييم، والحمولة معرّفات ونجوم بس. */
export type { LowRatingSubmitted } from '@pospay/contracts';

/** يصدر مرة لكل طلب تثبيت معاينة استيراد العملاء، بعد قفل المعاينة في معاملة القبول نفسها (073 D-4). */
export const CUSTOMER_IMPORT_COMMIT_REQUESTED = 'CustomerImportCommitRequested';

/** حمولة حدث تثبيت استيراد العملاء: معرّف المعاينة وحده، بلا بيانات شخصية. */
export type { CustomerImportCommitRequested } from '@pospay/contracts';
