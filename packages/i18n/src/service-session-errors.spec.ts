import { expect, it } from 'vitest';
import { serviceSessionErrors } from './service-session-errors.js';

const added = {
  SESSION_LINE_REVISION_STALE: {
    message_ar: 'اتغيّر السطر من حد تاني. افتحه تاني وراجع الأرقام الجديدة.',
    message_en: 'The line was changed by someone else. Reopen it and review the new figures.',
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
