import { expect, it } from 'vitest';
import { errorMessages } from './catalog.js';
import {
  discountApprovalErrorsAr,
  discountApprovalErrorsEn,
  discountApprovalRefusals,
} from './discount-approval-errors.js';

const CODES = Object.keys(discountApprovalErrorsEn) as (keyof typeof discountApprovalErrorsEn)[];

const ARABIC_ERRORS = {
  DISCOUNT_APPROVAL_NOT_NEEDED: 'الخصم ده جوّه حدّك، سجّليه على طول من غير موافقة.',
  DISCOUNT_PROPOSAL_NOT_PENDING: 'الطلب ده اتردّ عليه أو خلص وقته.',
  DISCOUNT_PROPOSAL_CHANGED: 'الطلب اتغيّر من ساعة ما فتحته، افتحه تاني.',
  DISCOUNT_APPROVER_LIMIT_TOO_LOW: 'الخصم أكبر من حدّك، محتاج موافقة حد حدّه أعلى.',
  DISCOUNT_APPROVER_IS_REQUESTER: 'مينفعش توافق على طلب إنت اللي طلبته.',
  DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED: 'اختاري العضوية اللي بتوافقي بيها.',
  DISCOUNT_REJECT_REASON_INVALID: 'سبب الرفض لحد 500 حرف.',
} as const;

const ARABIC_REFUSALS = {
  NOT_FOUND: 'مفيش موافقة صالحة',
  NOT_APPROVED: 'لسه متوافقش عليه',
  EXPIRED: 'الموافقة خلص وقتها',
  CONSUMED: 'الموافقة اتستخدمت',
  TERMS_MISMATCH: 'البيانات اتغيّرت عن اللي اتوافق عليه',
} as const;

it('publishes the seven discount-approval error codes of spec 057', () => {
  expect([...CODES].sort()).toEqual(
    [
      'DISCOUNT_APPROVAL_NOT_NEEDED',
      'DISCOUNT_PROPOSAL_NOT_PENDING',
      'DISCOUNT_PROPOSAL_CHANGED',
      'DISCOUNT_APPROVER_LIMIT_TOO_LOW',
      'DISCOUNT_APPROVER_IS_REQUESTER',
      'DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED',
      'DISCOUNT_REJECT_REASON_INVALID',
    ].sort(),
  );
});

it('keeps every discount-approval error in both languages', () => {
  for (const code of CODES) {
    expect(discountApprovalErrorsAr[code].trim()).not.toBe('');
    expect(discountApprovalErrorsEn[code].trim()).not.toBe('');
    expect(discountApprovalErrorsAr[code]).not.toBe(discountApprovalErrorsEn[code]);
  }
});

it('serves the discount-approval errors from the shared catalog', () => {
  for (const code of CODES) {
    expect(errorMessages(code)).toEqual({
      message_ar: discountApprovalErrorsAr[code],
      message_en: discountApprovalErrorsEn[code],
    });
  }
});

it('publishes the Arabic error text of spec 057', () => {
  for (const code of Object.keys(ARABIC_ERRORS) as (keyof typeof ARABIC_ERRORS)[]) {
    expect(discountApprovalErrorsAr[code]).toBe(ARABIC_ERRORS[code]);
  }
});

it('publishes the five approval refusal labels in both languages', () => {
  expect(Object.keys(discountApprovalRefusals).sort()).toEqual(
    ['NOT_FOUND', 'NOT_APPROVED', 'EXPIRED', 'CONSUMED', 'TERMS_MISMATCH'].sort(),
  );
  for (const label of Object.values(discountApprovalRefusals)) {
    expect(label.message_ar.trim()).not.toBe('');
    expect(label.message_en.trim()).not.toBe('');
    expect(label.message_ar).not.toBe(label.message_en);
  }
});

it('publishes the Arabic refusal labels of spec 057', () => {
  for (const code of Object.keys(ARABIC_REFUSALS) as (keyof typeof ARABIC_REFUSALS)[]) {
    expect(discountApprovalRefusals[code].message_ar).toBe(ARABIC_REFUSALS[code]);
  }
});
