import { expect, it } from 'vitest';
import { errorMessages } from './catalog.js';
import { serviceSessionErrors } from './service-session-errors.js';

const added = {
  SESSION_LINE_REVISION_STALE: {
    message_ar: 'اتغيّر السطر من حد تاني. حدّثي الصفحة وحاولي تاني.',
    message_en: 'The line was changed by someone else. Refresh and try again.',
  },
  SESSION_EDIT_NO_CHANGE: {
    message_ar: 'السعر والخصم زي ما هما، مفيش تعديل يتحفظ.',
    message_en: 'Price and discount are unchanged; nothing to save.',
  },
  SESSION_LINE_NOT_EDITABLE: {
    message_ar: 'السطر ده ملغي ومينفعش يتعدّل.',
    message_en: 'This line is cancelled and cannot be edited.',
  },
  SESSION_EDIT_REASON_INVALID: {
    message_ar: 'اكتب سبب التعديل (لحد 500 حرف).',
    message_en: 'Enter the reason for the edit (up to 500 characters).',
  },
  SESSION_EDITOR_MEMBERSHIP_REQUIRED: {
    message_ar: 'اختاري العضوية اللي بتعدّلي بيها.',
    message_en: 'Select the membership you are editing under.',
  },
  SESSION_EDIT_IDENTITY_UNKNOWN: {
    message_ar: 'مينفعش نتأكد مين نفّذ الخدمة دي (سطر قديم)، فمينفعش تتعدّل.',
    message_en: 'This older line has no performer identity record and cannot be edited.',
  },
} as const;

it('keeps every service-session error in both languages', () => {
  for (const messages of Object.values(serviceSessionErrors)) {
    expect(messages.message_ar.trim()).not.toBe('');
    expect(messages.message_en.trim()).not.toBe('');
    expect(messages.message_ar).toMatch(/[\u0600-\u06FF]/);
    expect(messages.message_en).not.toMatch(/[\u0600-\u06FF]/);
  }
});

it('publishes the line-edit errors from spec 35d', () => {
  for (const code of Object.keys(added) as (keyof typeof added)[]) {
    expect(serviceSessionErrors[code]).toEqual(added[code]);
  }
});

const tipMessages = {
  TIP_WINDOW_CLOSED: {
    message_ar: 'فات وقت تسجيل البقشيش للزيارة دي.',
    message_en: 'The time to record a tip for this visit has passed.',
  },
  TIP_SELF_FORBIDDEN: {
    message_ar: 'ماينفعش تسجّلي أو تغيّري بقشيشك إنتِ.',
    message_en: 'You cannot record or change your own tip.',
  },
  TIP_IDENTITY_UNKNOWN: {
    message_ar: 'البقشيش ده مايتعدّلش لأن هوية الموظفة في الزيارة مش معروفة.',
    message_en:
      "This tip cannot be changed because the performer's identity on this visit is unknown.",
  },
  TIP_EMPLOYEE_NOT_PERFORMER: {
    message_ar: 'الموظفة دي مش منفّذة لخدمة فعّالة في الزيارة.',
    message_en: 'This employee does not perform an active service on this visit.',
  },
  TIP_TOTAL_TOO_LARGE: {
    message_ar: 'إجمالي البقشيش أكبر من الحد المسموح.',
    message_en: 'The tip total is above the allowed limit.',
  },
} as const;

it('reuses the generic validation message for a malformed tip', () => {
  expect(serviceSessionErrors.VALIDATION_FAILED).toEqual(errorMessages('VALIDATION_FAILED'));
});

it('publishes the tip errors from spec 053', () => {
  for (const code of Object.keys(tipMessages) as (keyof typeof tipMessages)[]) {
    expect(serviceSessionErrors[code]).toEqual(tipMessages[code]);
  }
});

const recordTipMessages = {
  SESSION_NOT_FOUND: {
    message_ar: 'الزيارة دي مش موجودة.',
    message_en: 'Visit not found.',
  },
  TIP_REVISION_CONFLICT: {
    message_ar: 'البقشيش اتغيّر من حد تاني. حدّثي الصفحة وحاولي تاني.',
    message_en: 'The tips were changed by someone else. Refresh and try again.',
  },
  TIP_REASON_REQUIRED: {
    message_ar: 'اكتبي سبب تغيير البقشيش.',
    message_en: 'Enter the reason for changing the tips.',
  },
  TIP_NO_CHANGE: {
    message_ar: 'البقشيش زي ما هو، مفيش تغيير يتحفظ.',
    message_en: 'The tips are unchanged; nothing to save.',
  },
} as const;

it('publishes the record-tip errors from task 36-3a', () => {
  for (const code of Object.keys(recordTipMessages) as (keyof typeof recordTipMessages)[]) {
    expect(serviceSessionErrors[code]).toEqual(recordTipMessages[code]);
  }
});
