import { expect, it } from 'vitest';

import { attendanceStatementAr, attendanceStatementEn } from '../attendance-statement-catalog.js';
import { ar } from '../ar.js';
import { t } from '../catalog.js';
import { en } from '../en.js';

// الحزمة دي مالها اعتماد على packages/contracts، فمفيش استيراد لمفاتيح العقد من هنا؛
// المساواة مع attendanceStatementLabelKeys متأكد عليها في اختبار مصدر الـ worker،
// اللي بيشوف العقد والكتالوج مع بعض.

const ARABIC = /[\u0600-\u06FF]/;

it('registers the statement headings as one section in both locales', () => {
  expect(ar.attendanceStatement).toEqual(attendanceStatementAr);
  expect(en.attendanceStatement).toEqual(attendanceStatementEn);
  expect(t('ar', 'attendanceStatement.footer')).toBe(attendanceStatementAr.footer);
  expect(t('en', 'attendanceStatement.footer')).toBe(attendanceStatementEn.footer);
});

it('keeps the Arabic headings Arabic and the English ones English', () => {
  expect(Object.keys(attendanceStatementAr).sort()).toEqual(
    Object.keys(attendanceStatementEn).sort(),
  );
  for (const [key, text] of Object.entries(attendanceStatementAr)) {
    expect(text.trim(), key).not.toBe('');
    expect(text, key).toMatch(ARABIC);
  }
  for (const [key, text] of Object.entries(attendanceStatementEn)) {
    expect(text.trim(), key).not.toBe('');
    expect(text, key).not.toMatch(ARABIC);
  }
});

it('prints the owner footer text as it was written', () => {
  expect(attendanceStatementAr.footer).toBe('صادر من نظام PosPay للحضور والانصراف');
  expect(attendanceStatementEn.footer).toBe('Issued by the PosPay attendance system');
});
