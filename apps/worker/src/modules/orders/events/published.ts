/** يصدر للفائز بقرار جرس الزيارة المتأخرة، حدث واحد لكل مجموعة مديرين ضمن معاملة الدفتر. */
export type { LateServiceSessionNoticeRequested } from '@pospay/contracts';
/** يلحقه عامل orders مرة لكل مجموعة مستلمين بحد أقصى 100، داخل معاملة المستهلك التي تحجز صف دفتر (line, revision)، وفقط عندما يحمل التعديل المحفوظ change من نوع PRICE_DISCOUNT_EDIT ويوجد مدير مؤهل واحد على الأقل. */
export type { ServiceLineEditNoticeRequested } from '@pospay/contracts';
/** يلحقه عامل orders مرة لكل مجموعة مستلمين بحد أقصى 100، داخل معاملة المستهلك التي تحجز صف دفتر (line, revision)، وفقط عندما يحمل الإلغاء change من نوع LINE_CANCELLED ويوجد مدير مؤهل واحد على الأقل. */
export type { ServiceLineCancelNoticeRequested } from '@pospay/contracts';
/** يلحقه عامل orders مرة لكل مجموعة مستلمين بحد أقصى 100، داخل معاملة المستهلك التي تحجز صف دفتر (line, revision)، وفقط عندما يحمل التغيير المحفوظ change من نوع PERFORMERS_CHANGE ويوجد مدير مؤهل واحد على الأقل. */
export type { ServiceLinePerformersNoticeRequested } from '@pospay/contracts';
/** يلحقه عامل orders مرة لكل مجموعة مستلمين بحد أقصى 100، داخل معاملة المستهلك التي تحجز صف دفتر الطلب (request_id)، وفقط عندما يوجد مستلم واحد على الأقل غير الطالبة. */
export type { DiscountApprovalNoticeRequested } from '@pospay/contracts';
/** يلحقه عامل orders مرة لكل مجموعة ملاك بحد أقصى 100، داخل معاملة المستهلك التي تحجز دفتر القرار، وفقط عندما يوجد مالك نشط واحد على الأقل (DA-Q3). */
export type { DiscountSelfApprovalNoticeRequested } from '@pospay/contracts';
/** يصدره عامل orders داخل معاملة البيع نفسها مع قيد التدقيق، بعد إدخال الاستحقاق ومكوّناته وجلساته وقبل تعليم الطلب كمكتمل؛ aggregateType 'package_entitlement' وaggregateId هو معرّف الاستحقاق. */
export type { PackageSaleChanged } from '@pospay/contracts';

/** خلاصة استيراد الباقات داخل معاملة التثبيت؛ لا تحمل بيانات العملاء أو حدث بيع. */
export interface PackageImportCommitted {
  readonly preview_id: string;
  readonly business_id: string;
  readonly entity: 'packages';
  readonly created_count: number;
  readonly skipped_count: number;
  readonly committed_at: string;
}

/** يصدر من قبول بيع الباقة في معاملة إنشاء طلب pending نفسها، بمغلف aggregateType='package_sale_request' وaggregateId=request id وeventType='PackageSaleRequested' ومعرف الشركة في المغلف، ليعالجه عامل orders بمهمة package-sale. */
export interface PackageSaleRequested {
  readonly sale_request_id: string;
}
