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

// 080-b: فروع زيادة واستثناءات صلاحيات مضمّنة في نفس طلب المنح — كل واحدة اختيارية ومقفولة.
describe('the multi-branch grant body', () => {
  const grant = { phone: '+96551234567', phone_confirmed: true, role: 'staff', pin: '1234' } as const;
  const branch = { branch_id: challenge, role: 'reception' } as const;
  const override = {
    permission_code: 'read:attendance:branch',
    effect: 'ALLOW',
    scope_type: 'BRANCH',
    scope_id: challenge,
    reason: 'covering the front desk',
    expires_at: null,
  } as const;

  it('takes optional extra branches and inline permission overrides', () => {
    expect(grantStaffAccessInput.safeParse({ ...grant, additional_branches: [branch] }).success).toBe(
      true,
    );
    expect(
      grantStaffAccessInput.safeParse({ ...grant, permission_overrides: [override] }).success,
    ).toBe(true);
    expect(
      grantStaffAccessInput.safeParse({
        ...grant,
        additional_branches: [branch],
        permission_overrides: [override],
      }).success,
    ).toBe(true);
  });

  it('refuses an unknown extra-branch role, a malformed branch id and an unknown key', () => {
    expect(
      grantStaffAccessInput.safeParse({
        ...grant,
        additional_branches: [{ branch_id: challenge, role: 'owner' }],
      }).success,
    ).toBe(false);
    expect(
      grantStaffAccessInput.safeParse({
        ...grant,
        additional_branches: [{ branch_id: 'not-a-uuid', role: 'staff' }],
      }).success,
    ).toBe(false);
    expect(grantStaffAccessInput.safeParse({ ...grant, extra: 1 }).success).toBe(false);
  });

  it('refuses a malformed inline override and a primary role outside the closed list', () => {
    expect(
      grantStaffAccessInput.safeParse({
        ...grant,
        permission_overrides: [{ ...override, effect: 'MAYBE' }],
      }).success,
    ).toBe(false);
    expect(
      grantStaffAccessInput.safeParse({ ...grant, permission_overrides: [override, override] }).success,
    ).toBe(true);
    expect(grantStaffAccessInput.safeParse({ ...grant, role: 'owner' }).success).toBe(false);
  });
});

// 080-b: سقف العقد 20 لفروع الزيادة و20 للاستثناءات — نفس السقف في شاشة المنح.
describe('the multi-branch grant caps', () => {
  const grant = { phone: '+96551234567', phone_confirmed: true, role: 'staff', pin: '1234' } as const;
  const override = {
    permission_code: 'read:attendance:branch',
    effect: 'ALLOW',
    scope_type: 'BRANCH',
    scope_id: challenge,
    reason: 'covering the front desk',
    expires_at: null,
  } as const;

  it('takes twenty extra branches and refuses the twenty-first', () => {
    const branches = Array.from({ length: 20 }, (_, index) => ({
      branch_id: `01920000-0000-7000-8000-${String(index).padStart(12, '0')}`,
      role: 'staff' as const,
    }));
    expect(
      grantStaffAccessInput.safeParse({ ...grant, additional_branches: branches }).success,
    ).toBe(true);
    expect(
      grantStaffAccessInput.safeParse({
        ...grant,
        additional_branches: [...branches, { branch_id: challenge, role: 'staff' }],
      }).success,
    ).toBe(false);
  });

  it('takes twenty inline overrides and refuses the twenty-first', () => {
    const overrides = Array.from({ length: 20 }, () => override);
    expect(
      grantStaffAccessInput.safeParse({ ...grant, permission_overrides: overrides }).success,
    ).toBe(true);
    expect(
      grantStaffAccessInput.safeParse({
        ...grant,
        permission_overrides: [...overrides, override],
      }).success,
    ).toBe(false);
  });
});
