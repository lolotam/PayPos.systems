import { expect, it } from 'vitest';
import { t } from '../catalog.js';

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{([a-z_]+)\}\}/g)].map((match) => match[1]).sort();

it('registers the attendance exception bell copy in both locales', () => {
  const arabic = t('ar', 'inApp.attendance_exception_raised');
  const english = t('en', 'inApp.attendance_exception_raised');
  expect(arabic).toBe(
    '{{employee_name_ar}} سجّلت دخول في {{branch_name_ar}} يوم {{clock_in_date}} الساعة {{clock_in_time}} ولم تسجّل خروج',
  );
  expect(english).toBe(
    '{{employee_name_en}} clocked in at {{branch_name_en}} on {{clock_in_date}} at {{clock_in_time}} and has not clocked out',
  );
  expect(placeholders(arabic)).toEqual([
    'branch_name_ar',
    'clock_in_date',
    'clock_in_time',
    'employee_name_ar',
  ]);
  expect(placeholders(english)).toEqual([
    'branch_name_en',
    'clock_in_date',
    'clock_in_time',
    'employee_name_en',
  ]);
});

it('registers the document expiry bell copy in both locales', () => {
  const arabic = t('ar', 'inApp.document_expiring');
  const english = t('en', 'inApp.document_expiring');
  expect(arabic).toBe(
    'مستند {{document_type_ar}} الخاص بـ {{employee_name_ar}} ينتهي يوم {{expires_on}}',
  );
  expect(english).toBe("{{employee_name_en}}'s {{document_type_en}} expires on {{expires_on}}");
  expect(placeholders(arabic)).toEqual(['document_type_ar', 'employee_name_ar', 'expires_on']);
  expect(placeholders(english)).toEqual(['document_type_en', 'employee_name_en', 'expires_on']);
});

it('registers the numbered document expiry bell copy in both locales with the number placeholder', () => {
  const arabic = t('ar', 'inApp.document_expiring_numbered');
  const english = t('en', 'inApp.document_expiring_numbered');
  expect(arabic).toBe(
    'مستند {{document_type_ar}} الخاص بـ {{employee_name_ar}} ينتهي يوم {{expires_on}} — رقم المستند {{document_number}}',
  );
  expect(english).toBe(
    "{{employee_name_en}}'s {{document_type_en}} expires on {{expires_on}} · document no. {{document_number}}",
  );
  expect(placeholders(arabic)).toEqual([
    'document_number',
    'document_type_ar',
    'employee_name_ar',
    'expires_on',
  ]);
  expect(placeholders(english)).toEqual([
    'document_number',
    'document_type_en',
    'employee_name_en',
    'expires_on',
  ]);
});

it('registers the generic document name in both locales', () => {
  expect(t('ar', 'inApp.generic_document')).toBe('مستند');
  expect(t('en', 'inApp.generic_document')).toBe('Document');
});

it('registers an Arabic document-type fallback that reads naturally after «مستند»', () => {
  expect(t('en', 'inApp.generic_document_type')).toBe('Document');
  const rendered = t('ar', 'inApp.document_expiring').replace(
    '{{document_type_ar}}',
    t('ar', 'inApp.generic_document_type'),
  );
  expect(rendered.startsWith('مستند غير محدد الخاص بـ')).toBe(true);
  expect(rendered.match(/مستند/g)).toHaveLength(1);
});
