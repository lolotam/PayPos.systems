import { expect, it } from 'vitest';

import { validInAppTemplate, type SafeParameter } from '../index.ts';

const DOCUMENT = '01920000-0000-7000-8000-0000000000d1';

const exceptionParameters: readonly SafeParameter[] = [
  { name: 'employee_name_ar', type: 'text', value: 'سارة' },
  { name: 'employee_name_en', type: 'text', value: 'Sara' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'clock_in_date', type: 'text', value: '2026-10-23' },
  { name: 'clock_in_time', type: 'text', value: '09:02' },
];

const documentParameters: readonly SafeParameter[] = [
  { name: 'employee_name_ar', type: 'text', value: 'سارة' },
  { name: 'employee_name_en', type: 'text', value: 'Sara' },
  { name: 'document_type_ar', type: 'text', value: 'إقامة' },
  { name: 'document_type_en', type: 'text', value: 'Residency' },
  { name: 'expires_on', type: 'text', value: '2026-11-04' },
  { name: 'document_id', type: 'text', value: DOCUMENT },
];

it.each(['ar', 'en'])('validates the attendance exception bell in %s', (locale) => {
  expect(validInAppTemplate('attendance_exception_raised', 1, locale, exceptionParameters)).toBe(
    true,
  );
  expect(validInAppTemplate('attendance_exception_raised', 2, locale, exceptionParameters)).toBe(
    false,
  );
  expect(
    validInAppTemplate('attendance_exception_raised', 1, locale, exceptionParameters.slice(0, 5)),
  ).toBe(false);
  for (const value of ['24:00', '9:02', '2026-10-23']) {
    expect(
      validInAppTemplate(
        'attendance_exception_raised',
        1,
        locale,
        exceptionParameters.map((parameter) =>
          parameter.name === 'clock_in_time' ? { ...parameter, value } : parameter,
        ),
      ),
    ).toBe(false);
  }
  expect(
    validInAppTemplate(
      'attendance_exception_raised',
      1,
      locale,
      exceptionParameters.map((parameter) =>
        parameter.name === 'clock_in_date' ? { ...parameter, value: '23-10-2026' } : parameter,
      ),
    ),
  ).toBe(false);
});

it.each(['ar', 'en'])('validates the document expiry bell in %s', (locale) => {
  expect(validInAppTemplate('document_expiring', 1, locale, documentParameters)).toBe(true);
  expect(validInAppTemplate('document_expiring', 2, locale, documentParameters)).toBe(false);
  for (const value of ['not-a-uuid', DOCUMENT.toUpperCase(), '123456']) {
    expect(
      validInAppTemplate(
        'document_expiring',
        1,
        locale,
        documentParameters.map((parameter) =>
          parameter.name === 'document_id' ? { ...parameter, value } : parameter,
        ),
      ),
    ).toBe(false);
  }
  expect(
    validInAppTemplate(
      'document_expiring',
      1,
      locale,
      documentParameters.map((parameter) =>
        parameter.name === 'expires_on' ? { ...parameter, value: '2026-13-04' } : parameter,
      ),
    ),
  ).toBe(false);
  expect(
    validInAppTemplate('document_expiring', 1, locale, [
      ...documentParameters,
      { name: 'document_number', type: 'text', value: 'A-12345' },
    ]),
  ).toBe(false);
});
