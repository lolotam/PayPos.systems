import { expect, it } from 'vitest';

import {
  inAppNotification,
  inAppRecipient,
  notificationRequest,
  staffAccessGrantedEventPayload,
  staffAccessGrantedNoticeRequested,
  staffAccessGrantedRecipient,
  staffAccessNoticeGroupSize,
  staffAccessNoticeParameters,
  staffPinSetByOtherEventPayload,
  staffPinSetByOtherNoticeRequested,
  staffPinSetByOtherRecipient,
  staffPinRecoveredEventPayload,
  staffPinRecoveredNoticeRequested,
  staffPinRecoveredRecipient,
} from '../index.js';

const USER = '01920000-0000-7000-8000-0000000000f1';
const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
const BRANCH = '01920000-0000-7000-8000-0000000000b1';
const BUSINESS = '01920000-0000-7000-8000-0000000000a1';
const MEMBERSHIP = '01920000-0000-7000-8000-0000000000c1';

const safeParameters = [
  { name: 'employee_name_ar', type: 'text', value: 'سارة' },
  { name: 'employee_name_en', type: 'text', value: 'Sara' },
  { name: 'actor_name_ar', type: 'text', value: 'هبة' },
  { name: 'actor_name_en', type: 'text', value: 'Heba' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'occurred_date', type: 'text', value: '2026-11-25' },
  { name: 'occurred_time', type: 'text', value: '09:30' },
];

const grantedRecipient = {
  channel: 'IN_APP',
  user_id: USER,
  locale: 'ar',
  template_revision: 1,
  template_key: 'staff_access_granted',
  safe_parameters: safeParameters,
};

const pinRecipient = {
  ...grantedRecipient,
  template_key: 'staff_pin_set_by_other',
};

const recoveredRecipient = {
  ...grantedRecipient,
  template_key: 'staff_pin_recovered',
};

it('reads the two staff access event payloads as identifiers only', () => {
  expect(
    staffAccessGrantedEventPayload.parse({
      employee_id: EMPLOYEE,
      user_id: USER,
      membership_id: MEMBERSHIP,
      branch_id: BRANCH,
      role: 'staff',
    }),
  ).toEqual({
    employee_id: EMPLOYEE,
    user_id: USER,
    membership_id: MEMBERSHIP,
    branch_id: BRANCH,
    role: 'staff',
  });
  expect(
    staffPinSetByOtherEventPayload.parse({
      employee_id: EMPLOYEE,
      user_id: USER,
      branch_id: BRANCH,
    }),
  ).toEqual({ employee_id: EMPLOYEE, user_id: USER, branch_id: BRANCH });
  expect(
    staffPinRecoveredEventPayload.parse({
      employee_id: EMPLOYEE,
      user_id: USER,
      branch_id: BRANCH,
    }),
  ).toEqual({ employee_id: EMPLOYEE, user_id: USER, branch_id: BRANCH });
  expect(
    staffAccessGrantedEventPayload.safeParse({
      employee_id: EMPLOYEE,
      user_id: USER,
      membership_id: MEMBERSHIP,
      branch_id: BRANCH,
      role: 'owner',
    }).success,
  ).toBe(false);
  expect(
    staffPinSetByOtherEventPayload.safeParse({
      employee_id: EMPLOYEE,
      user_id: USER,
      branch_id: BRANCH,
      pin: '1234',
    }).success,
  ).toBe(false);
});

it('accepts both recipients with the ordered safe parameters', () => {
  expect(staffAccessNoticeParameters.parse(safeParameters)).toEqual(safeParameters);
  expect(staffAccessGrantedRecipient.parse(grantedRecipient)).toEqual(grantedRecipient);
  expect(staffPinSetByOtherRecipient.parse(pinRecipient)).toEqual(pinRecipient);
  expect(staffPinRecoveredRecipient.parse(recoveredRecipient)).toEqual(recoveredRecipient);
  expect(inAppRecipient.parse(grantedRecipient)).toEqual(grantedRecipient);
  expect(inAppRecipient.parse(pinRecipient)).toEqual(pinRecipient);
  expect(inAppRecipient.parse(recoveredRecipient)).toEqual(recoveredRecipient);
});

it('refuses unsafe names, a bad date, a bad time and an extra parameter', () => {
  for (const value of ['https://example.test/private', '+96500000001', '123456', '00000001']) {
    expect(
      staffAccessGrantedRecipient.safeParse({
        ...grantedRecipient,
        safe_parameters: safeParameters.map((parameter) =>
          parameter.name === 'actor_name_en' ? { ...parameter, value } : parameter,
        ),
      }).success,
    ).toBe(false);
  }
  expect(
    staffAccessGrantedRecipient.safeParse({
      ...grantedRecipient,
      safe_parameters: safeParameters.map((parameter) =>
        parameter.name === 'occurred_date' ? { ...parameter, value: '25-11-2026' } : parameter,
      ),
    }).success,
  ).toBe(false);
  expect(
    staffPinSetByOtherRecipient.safeParse({
      ...pinRecipient,
      safe_parameters: safeParameters.map((parameter) =>
        parameter.name === 'occurred_time' ? { ...parameter, value: '24:00' } : parameter,
      ),
    }).success,
  ).toBe(false);
  for (const extra of [
    { name: 'pin', type: 'text', value: '1234' },
    { name: 'phone', type: 'text', value: '+96500000001' },
  ]) {
    expect(
      staffAccessGrantedRecipient.safeParse({
        ...grantedRecipient,
        safe_parameters: [...safeParameters, extra],
      }).success,
    ).toBe(false);
  }
});

it('accepts the two notice request events with one group of recipients', () => {
  const granted = {
    schema_version: 1,
    business_id: BUSINESS,
    branch_id: BRANCH,
    employee_id: EMPLOYEE,
    notification_recipients: [grantedRecipient],
  };
  const pin = { ...granted, notification_recipients: [pinRecipient] };
  const recovered = { ...granted, notification_recipients: [recoveredRecipient] };
  expect(staffAccessGrantedNoticeRequested.parse(granted)).toEqual(granted);
  expect(staffPinSetByOtherNoticeRequested.parse(pin)).toEqual(pin);
  expect(staffPinRecoveredNoticeRequested.parse(recovered)).toEqual(recovered);
  expect(
    staffAccessGrantedNoticeRequested.safeParse({
      ...granted,
      notification_recipients: [],
    }).success,
  ).toBe(false);
  expect(
    staffAccessGrantedNoticeRequested.safeParse({
      ...granted,
      notification_recipients: [pinRecipient],
    }).success,
  ).toBe(false);
  expect(
    staffPinSetByOtherNoticeRequested.safeParse({
      ...pin,
      notification_recipients: [grantedRecipient],
    }).success,
  ).toBe(false);
  expect(staffAccessNoticeGroupSize).toBe(100);
});

it('reads all three notice requests through the notification request contract', () => {
  for (const recipient of [grantedRecipient, pinRecipient, recoveredRecipient]) {
    expect(
      notificationRequest.safeParse({
        business_id: BUSINESS,
        branch_id: BRANCH,
        notification_recipients: [recipient],
      }).success,
    ).toBe(true);
  }
});

it('reads all three bells through the in-app notification contract', () => {
  for (const recipient of [grantedRecipient, pinRecipient, recoveredRecipient]) {
    const item = {
      id: USER,
      company_id: USER,
      business_id: BUSINESS,
      branch_id: BRANCH,
      source_event_id: USER,
      template_key: recipient.template_key,
      template_revision: 1,
      locale: 'ar',
      safe_parameters: safeParameters,
      created_at: '2026-11-25T09:30:00Z',
      read_at: null,
    };
    expect(inAppNotification.parse(item)).toEqual(item);
    expect(
      inAppNotification.safeParse({
        ...item,
        safe_parameters: [...safeParameters, { name: 'pin', type: 'text', value: '1234' }],
      }).success,
    ).toBe(false);
  }
});

it('accepts the optional actor and timestamp on the staff access events', () => {
  const stamp = { actor_user_id: USER, occurred_at: '2026-11-25T06:30:00.000Z' };
  expect(
    staffAccessGrantedEventPayload.parse({
      employee_id: EMPLOYEE,
      user_id: USER,
      membership_id: MEMBERSHIP,
      branch_id: BRANCH,
      role: 'staff',
      ...stamp,
    }),
  ).toMatchObject(stamp);
  expect(
    staffPinSetByOtherEventPayload.parse({
      employee_id: EMPLOYEE,
      user_id: USER,
      branch_id: BRANCH,
      ...stamp,
    }),
  ).toMatchObject(stamp);
  expect(
    staffPinSetByOtherEventPayload.safeParse({
      employee_id: EMPLOYEE,
      user_id: USER,
      branch_id: BRANCH,
      actor_user_id: USER,
      occurred_at: 'yesterday',
    }).success,
  ).toBe(false);
});
