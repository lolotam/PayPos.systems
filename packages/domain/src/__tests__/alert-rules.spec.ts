import { describe, expect, it } from 'vitest';
import {
  ALERT_KIND_DEFINITIONS,
  ALERT_KINDS,
  alertRuleViolation,
  effectiveAlertRule,
  type AlertRuleSettings,
} from '../alert-rules.js';

const rule = (patch: Partial<AlertRuleSettings> = {}): AlertRuleSettings => ({
  enabled: true,
  recipientRoles: ['owner', 'branch_manager'],
  channels: ['IN_APP'],
  delayMinutes: null,
  leadMinutes: null,
  ...patch,
});

describe('effectiveAlertRule', () => {
  it('absent rules give the AL-Q5 default of every kind', () => {
    for (const kind of ALERT_KINDS) {
      const effective = effectiveAlertRule(kind, null, null, null);
      expect(effective.source).toBe('DEFAULT');
      expect(effective.enabled).toBe(true);
      expect(effective.recipientRoles).toEqual(ALERT_KIND_DEFINITIONS[kind].defaults.recipientRoles);
    }
    expect(effectiveAlertRule('SHIFT_NOT_CLOCKED_IN', null, null, null)).toMatchObject({
      delayMinutes: 20,
      channels: ['IN_APP'],
      recipientRoles: ['owner', 'general_manager', 'business_manager', 'branch_manager'],
      fixedRecipients: [{ selector: 'EMPLOYEE_PUSH' }],
    });
    expect(effectiveAlertRule('SHIFT_ENDS_SOON', null, null, null)).toMatchObject({
      leadMinutes: 30,
      channels: [],
      recipientRoles: [],
    });
    expect(effectiveAlertRule('DOCUMENT_EXPIRING', null, null, null)).toMatchObject({
      leadMinutes: null,
      fixedRecipients: [{ selector: 'PERMISSION_HOLDERS', permission: 'read:files:business' }],
    });
  });

  it('RT-26b: the branch override wins for its branch; the business rule for the others', () => {
    const business = rule({ delayMinutes: 20 });
    const salmiya = rule({ delayMinutes: 10 });
    expect(effectiveAlertRule('SHIFT_NOT_CLOCKED_IN', business, salmiya, null)).toMatchObject({
      source: 'BRANCH',
      delayMinutes: 10,
    });
    expect(effectiveAlertRule('SHIFT_NOT_CLOCKED_IN', business, null, null)).toMatchObject({
      source: 'BUSINESS',
      delayMinutes: 20,
    });
  });

  it('RT-26: a kind switched off carries no recipients, channels or fixed recipients', () => {
    const off = effectiveAlertRule('SHIFT_NOT_CLOCKED_IN', rule({ enabled: false, delayMinutes: 20 }), null, null);
    expect(off).toMatchObject({ enabled: false, masterOff: false, recipientRoles: [], channels: [], fixedRecipients: [] });
  });

  it('RT-26: the master switch off stops every kind, overrides included; null means on', () => {
    for (const kind of ALERT_KINDS) {
      expect(effectiveAlertRule(kind, null, null, false)).toMatchObject({ enabled: false, masterOff: true, recipientRoles: [] });
      expect(effectiveAlertRule(kind, null, null, true).enabled).toBe(true);
    }
    expect(effectiveAlertRule('ATTENDANCE_EXCEPTION', null, rule(), false).enabled).toBe(false);
  });
});

describe('alertRuleViolation', () => {
  it('accepts the default of every kind', () => {
    for (const kind of ALERT_KINDS)
      expect(alertRuleViolation(kind, ALERT_KIND_DEFINITIONS[kind].defaults)).toBeNull();
  });

  it('a delay only where the kind has one, and required there', () => {
    expect(alertRuleViolation('ATTENDANCE_EXCEPTION', rule({ delayMinutes: 5 }))).toBe('DELAY_NOT_ALLOWED');
    expect(alertRuleViolation('SHIFT_NOT_CLOCKED_IN', rule())).toBe('DELAY_REQUIRED');
  });

  it('a lead only where the kind has one; document expiry never has one', () => {
    expect(alertRuleViolation('DOCUMENT_EXPIRING', rule({ leadMinutes: 60 }))).toBe('LEAD_NOT_ALLOWED');
    expect(
      alertRuleViolation('SHIFT_ENDS_SOON', rule({ recipientRoles: [], channels: [] })),
    ).toBe('LEAD_REQUIRED');
  });

  it('minutes stay within 1..1440 and whole', () => {
    expect(alertRuleViolation('SHIFT_NOT_CLOCKED_IN', rule({ delayMinutes: 0 }))).toBe('MINUTES_OUT_OF_RANGE');
    expect(alertRuleViolation('SHIFT_NOT_CLOCKED_IN', rule({ delayMinutes: 1441 }))).toBe('MINUTES_OUT_OF_RANGE');
    expect(alertRuleViolation('SHIFT_NOT_CLOCKED_IN', rule({ delayMinutes: 1.5 }))).toBe('MINUTES_OUT_OF_RANGE');
    expect(alertRuleViolation('SHIFT_NOT_CLOCKED_IN', rule({ delayMinutes: 1440 }))).toBeNull();
  });

  it('the employee-only kind takes no roles or channels; duplicates are refused', () => {
    expect(
      alertRuleViolation('SHIFT_ENDS_SOON', rule({ channels: [], leadMinutes: 30 })),
    ).toBe('ROLES_NOT_ALLOWED');
    expect(
      alertRuleViolation('SHIFT_ENDS_SOON', rule({ recipientRoles: [], leadMinutes: 30 })),
    ).toBe('CHANNELS_NOT_ALLOWED');
    expect(
      alertRuleViolation('ATTENDANCE_EXCEPTION', rule({ recipientRoles: ['owner', 'owner'] })),
    ).toBe('DUPLICATE_VALUE');
    expect(
      alertRuleViolation('ATTENDANCE_EXCEPTION', rule({ channels: ['IN_APP', 'IN_APP'] })),
    ).toBe('DUPLICATE_VALUE');
  });
});
