export const discountApprovalErrorsEn = {
  DISCOUNT_APPROVAL_NOT_NEEDED: 'This discount is within your limit; record it without approval.',
  DISCOUNT_PROPOSAL_NOT_PENDING: 'This request was already decided or has expired.',
  DISCOUNT_PROPOSAL_CHANGED: 'The request changed since you opened it; reopen it.',
  DISCOUNT_APPROVER_LIMIT_TOO_LOW:
    'This discount is above your limit; it needs an approver with a higher limit.',
  DISCOUNT_APPROVER_IS_REQUESTER: 'You cannot approve your own request.',
  DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED: 'Select the membership you are approving under.',
  DISCOUNT_REJECT_REASON_INVALID: 'The reject reason is up to 500 characters.',
};

export const discountApprovalErrorsAr = {
  DISCOUNT_APPROVAL_NOT_NEEDED: 'الخصم ده جوّه حدّك، سجّليه على طول من غير موافقة.',
  DISCOUNT_PROPOSAL_NOT_PENDING: 'الطلب ده اتردّ عليه أو خلص وقته.',
  DISCOUNT_PROPOSAL_CHANGED: 'الطلب اتغيّر من ساعة ما فتحته، افتحه تاني.',
  DISCOUNT_APPROVER_LIMIT_TOO_LOW: 'الخصم أكبر من حدّك، محتاج موافقة حد حدّه أعلى.',
  DISCOUNT_APPROVER_IS_REQUESTER: 'مينفعش توافق على طلب إنت اللي طلبته.',
  DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED: 'اختاري العضوية اللي بتوافقي بيها.',
  DISCOUNT_REJECT_REASON_INVALID: 'سبب الرفض لحد 500 حرف.',
};

/** أسباب رفض السطر عند استهلاك الموافقة، نفس قيم `approval_refusal` في العقد. */
export type DiscountApprovalRefusalCode =
  | 'NOT_FOUND'
  | 'NOT_APPROVED'
  | 'EXPIRED'
  | 'CONSUMED'
  | 'TERMS_MISMATCH';

/** تسميات أسباب الرفض، تُعرض على السطر المرفوض بجانبيها. */
export const discountApprovalRefusals: Record<
  DiscountApprovalRefusalCode,
  { message_ar: string; message_en: string }
> = {
  NOT_FOUND: { message_ar: 'مفيش موافقة صالحة', message_en: 'No valid approval' },
  NOT_APPROVED: { message_ar: 'لسه متوافقش عليه', message_en: 'Not approved yet' },
  EXPIRED: { message_ar: 'الموافقة خلص وقتها', message_en: 'The approval has expired' },
  CONSUMED: { message_ar: 'الموافقة اتستخدمت', message_en: 'The approval was already used' },
  TERMS_MISMATCH: {
    message_ar: 'البيانات اتغيّرت عن اللي اتوافق عليه',
    message_en: 'The details changed from what was approved',
  },
};
