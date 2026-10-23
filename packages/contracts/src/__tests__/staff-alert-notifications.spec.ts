import { expect, it } from 'vitest';

import {
  attendanceExceptionRaisedParameters,
  attendanceExceptionRaisedRecipient,
  documentExpiringParameters,
  documentExpiringRecipient,
  inAppNotification,
  inAppRecipient,
} from '../index.js';

const USER = '01920000-0000-7000-8000-0000000000f1';
const DOCUMENT = '01920000-0000-7000-8000-0000000000d1';

const exceptionRecipient = {
  channel: 'IN_APP',
  user_id: USER,
  locale: 'ar',
  template_revision: 1,
  template_key: 'attendance_exception_raised',
  safe_parameters: [
    { name: 'employee_name_ar', type: 'text', value: 'سارة' },
    { name: 'employee_name_en', type: 'text', value: 'Sara' },
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'clock_in_date', type: 'text', value: '2026-10-23' },
    { name: 'clock_in_time', type: 'text', value: '09:02' },
  ],
};

const documentRecipient = {
  channel: 'IN_APP',
  user_id: USER,
  locale: 'ar',
  template_revision: 1,
  template_key: 'document_expiring',
  safe_parameters: [
    { name: 'employee_name_ar', type: 'text', value: 'سارة' },
    { name: 'employee_name_en', type: 'text', value: 'Sara' },
    { name: 'document_type_ar', type: 'text', value: 'إقامة' },
    { name: 'document_type_en', type: 'text', value: 'Residency' },
    { name: 'expires_on', type: 'text', value: '2026-11-04' },
    { name: 'document_id', type: 'text', value: DOCUMENT },
  ],
};

it('accepts a valid attendance exception recipient and its parameters', () => {
  expect(attendanceExceptionRaisedParameters.parse(exceptionRecipient.safe_parameters)).toEqual(
    exceptionRecipient.safe_parameters,
  );
  expect(attendanceExceptionRaisedRecipient.parse(exceptionRecipient)).toEqual(exceptionRecipient);
  expect(inAppRecipient.parse(exceptionRecipient)).toEqual(exceptionRecipient);
});

it('accepts a valid document expiry recipient and its parameters', () => {
  expect(documentExpiringParameters.parse(documentRecipient.safe_parameters)).toEqual(
    documentRecipient.safe_parameters,
  );
  expect(documentExpiringRecipient.parse(documentRecipient)).toEqual(documentRecipient);
  expect(inAppRecipient.parse(documentRecipient)).toEqual(documentRecipient);
});

it('refuses a document recipient without a uuid, without a date or with an extra parameter', () => {
  expect(
    documentExpiringRecipient.safeParse({
      ...documentRecipient,
      safe_parameters: documentRecipient.safe_parameters.map((parameter) =>
        parameter.name === 'document_id' ? { ...parameter, value: 'not-a-uuid' } : parameter,
      ),
    }).success,
  ).toBe(false);
  expect(
    documentExpiringRecipient.safeParse({
      ...documentRecipient,
      safe_parameters: documentRecipient.safe_parameters.map((parameter) =>
        parameter.name === 'expires_on' ? { ...parameter, value: '04-11-2026' } : parameter,
      ),
    }).success,
  ).toBe(false);
  expect(
    documentExpiringRecipient.safeParse({
      ...documentRecipient,
      safe_parameters: [
        ...documentRecipient.safe_parameters,
        { name: 'document_number', type: 'text', value: 'A-12345' },
      ],
    }).success,
  ).toBe(false);
});

it('refuses an attendance exception recipient with a time outside HH:MM', () => {
  for (const value of ['24:00', '9:02', '09:60', '0900']) {
    expect(
      attendanceExceptionRaisedRecipient.safeParse({
        ...exceptionRecipient,
        safe_parameters: exceptionRecipient.safe_parameters.map((parameter) =>
          parameter.name === 'clock_in_time' ? { ...parameter, value } : parameter,
        ),
      }).success,
    ).toBe(false);
  }
});

it('reads both bell shapes through the in-app notification contract', () => {
  for (const [template_key, safe_parameters] of [
    ['attendance_exception_raised', exceptionRecipient.safe_parameters],
    ['document_expiring', documentRecipient.safe_parameters],
  ] as const) {
    const item = {
      id: USER,
      company_id: USER,
      business_id: USER,
      branch_id: USER,
      source_event_id: USER,
      template_key,
      template_revision: 1,
      locale: 'ar',
      safe_parameters,
      created_at: '2026-10-23T09:02:00Z',
      read_at: null,
    };
    expect(inAppNotification.parse(item)).toEqual(item);
  }
});
