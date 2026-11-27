import { describe, expect, it } from 'vitest';
import { createEmployeeInput } from '../staff/employee.js';
import { grantStaffAccessInput } from '../staff/staff-access.js';
import { staffPinResetOtpInput, staffPinResetRequestInput } from './staff-pin-reset.js';

const challenge = '01920000-0000-7000-8000-000000000001';

describe('staff PIN recovery request', () => {
  it.each([
    ['EMAIL', 'sara@example.test'],
    ['WHATSAPP', '+96551234567'],
  ] as const)('accepts a well-formed %s identifier', (channel, identifier) => {
    expect(staffPinResetRequestInput.safeParse({ channel, identifier, locale: 'ar' }).success).toBe(
      true,
    );
  });

  it.each([
    ['EMAIL', '+96551234567'],
    ['WHATSAPP', 'sara@example.test'],
    ['EMAIL', 'no-at-sign'],
    ['WHATSAPP', '0551234567'],
  ] as const)('rejects a %s request carrying %s', (channel, identifier) => {
    expect(staffPinResetRequestInput.safeParse({ channel, identifier, locale: 'en' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown channel, an extra key and a missing locale', () => {
    const ok = { channel: 'EMAIL', identifier: 'sara@example.test', locale: 'en' };
    expect(staffPinResetRequestInput.safeParse({ ...ok, channel: 'SMS' }).success).toBe(false);
    expect(staffPinResetRequestInput.safeParse({ ...ok, role: 'owner' }).success).toBe(false);
    expect(staffPinResetRequestInput.safeParse({ ...ok, locale: undefined }).success).toBe(false);
  });
});

describe('staff PIN recovery reset', () => {
  it('takes a six-digit code and a four-digit PIN and nothing else', () => {
    const ok = { challenge_id: challenge, code: '123456', pin: '4821' };
    expect(staffPinResetOtpInput.safeParse(ok).success).toBe(true);
    expect(staffPinResetOtpInput.safeParse({ ...ok, code: '12345' }).success).toBe(false);
    expect(staffPinResetOtpInput.safeParse({ ...ok, pin: '482' }).success).toBe(false);
    expect(staffPinResetOtpInput.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

describe('the optional recovery email on employees', () => {
  const employee = {
    primary_branch_id: challenge,
    name_en: 'Sara',
    role_code: 'staff',
    hire_date: '2026-01-01',
  } as const;

  it('is optional, nullable and format-checked on create', () => {
    expect(createEmployeeInput.safeParse(employee).success).toBe(true);
    expect(createEmployeeInput.safeParse({ ...employee, recovery_email: null }).success).toBe(true);
    expect(
      createEmployeeInput.safeParse({ ...employee, recovery_email: 'sara@example.test' }).success,
    ).toBe(true);
    expect(createEmployeeInput.safeParse({ ...employee, recovery_email: 'nope' }).success).toBe(
      false,
    );
  });

  it('is optional and format-checked when granting access', () => {
    const grant = { phone: '+96551234567', phone_confirmed: true, role: 'staff', pin: '1234' };
    expect(grantStaffAccessInput.safeParse(grant).success).toBe(true);
    expect(
      grantStaffAccessInput.safeParse({ ...grant, recovery_email: 'sara@example.test' }).success,
    ).toBe(true);
    expect(grantStaffAccessInput.safeParse({ ...grant, recovery_email: 'nope' }).success).toBe(
      false,
    );
  });
});
