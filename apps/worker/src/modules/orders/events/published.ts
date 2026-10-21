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
