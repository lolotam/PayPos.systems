/** سياق الإشعار يحمل المستخدم المحدد من المنتج، ولا يحتاج قراءة جهات اتصال. */
export interface InAppInput {
  readonly companyId: string;
  readonly sourceEventId: string;
  readonly recipientUserId: string;
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly locale: 'ar' | 'en';
  readonly safeParameters: readonly ScalarInAppParameter[] | readonly [DetailsInAppParameter];
}
/** معامل نصي أو رقمي من قوالب الجرس العادية، يتعرض كما هو في النص. */
export interface ScalarInAppParameter {
  readonly name: string;
  readonly type: 'text' | 'number';
  readonly value: string | number;
}
/** المعامل الوحيد لجرس التقييم المنخفض: كائن تفاصيل اتحقق شكله قبل التخزين ويتخزن كما هو. */
export interface DetailsInAppParameter {
  readonly name: 'details';
  readonly type: 'details';
  readonly value: Readonly<Record<string, unknown>>;
}
