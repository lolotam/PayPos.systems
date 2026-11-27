import { effectiveAlertRule, type EffectiveAlertRule } from '@pospay/domain';
import { describe, expect, it } from 'vitest';
import {
  MIN_ALERT_DELAY_MS,
  employeePushRecipient,
  alertOn,
  alertRoles,
  leadAlertPlan,
  periodicAlertPlan,
  type PeriodicAlertRule,
} from '../alert-rule-plan.ts';

const MINUTE = 60 * 1000;
const MANAGERS = ['owner', 'general_manager', 'business_manager', 'branch_manager'] as const;

function rule(patch: Partial<PeriodicAlertRule> = {}): PeriodicAlertRule {
  return {
    kind: 'SHIFT_NOT_CLOCKED_IN',
    enabled: true,
    recipientRoles: MANAGERS,
    channels: ['IN_APP'],
    fixedRecipients: [{ selector: 'EMPLOYEE_PUSH' }],
    delayMinutes: 20,
    ...patch,
  };
}

function leadRule(
  patch: Partial<Pick<EffectiveAlertRule, 'kind' | 'enabled' | 'fixedRecipients' | 'leadMinutes'>> = {},
): Pick<EffectiveAlertRule, 'kind' | 'enabled' | 'fixedRecipients' | 'leadMinutes'> {
  return {
    kind: 'SHIFT_ENDS_SOON',
    enabled: true,
    fixedRecipients: [{ selector: 'EMPLOYEE_PUSH' }],
    leadMinutes: null,
    ...patch,
  };
}

describe('periodicAlertPlan channels (62b-1)', () => {
  it('keeps the roles and the channels of an email-only or WhatsApp-only rule (62b-1)', () => {
    expect(periodicAlertPlan(rule({ channels: ['EMAIL'] }))).toMatchObject({
      roles: MANAGERS,
      channels: ['EMAIL'],
    });
    expect(periodicAlertPlan(rule({ channels: ['IN_APP', 'WHATSAPP'] }))).toMatchObject({
      roles: MANAGERS,
      channels: ['IN_APP', 'WHATSAPP'],
    });
  });

  it('gives no roles when the rule has no channel at all', () => {
    expect(periodicAlertPlan(rule({ channels: [] }))).toMatchObject({ roles: [], channels: [] });
  });
});

describe('periodicAlertPlan', () => {
  it('reads the delay, the roles and the fixed employee push off an open rule', () => {
    expect(periodicAlertPlan(rule())).toEqual({
      enabled: true,
      delayMs: 20 * MINUTE,
      roles: MANAGERS,
      channels: ['IN_APP'],
      employeePush: true,
    });
  });

  it('keeps the stored delay of a closed rule so the suppression path knows it was overdue', () => {
    expect(periodicAlertPlan(rule({ enabled: false }))).toEqual({
      enabled: false,
      delayMs: 20 * MINUTE,
      roles: [],
      channels: [],
      employeePush: false,
    });
  });

  it('closes the plan with the master switch and falls back to the kind default delay', () => {
    const closed = effectiveAlertRule('SHIFT_NOT_CLOCKED_IN', null, null, false);
    expect(periodicAlertPlan(closed)).toEqual({
      enabled: false,
      delayMs: 20 * MINUTE,
      roles: [],
      channels: [],
      employeePush: false,
    });
  });

  it('takes the delay from the kind default when the rule row carries none', () => {
    expect(periodicAlertPlan(rule({ delayMinutes: null })).delayMs).toBe(20 * MINUTE);
    expect(
      periodicAlertPlan(
        rule({ kind: 'SHIFT_BREAK_NOT_RETURNED', delayMinutes: null }),
      ).delayMs,
    ).toBe(10 * MINUTE);
  });

  it('falls back to ten minutes for a kind with no delay of its own', () => {
    expect(
      periodicAlertPlan(
        rule({ kind: 'SHIFT_BREAK_RETURNED_OTHER_BRANCH', delayMinutes: null }),
      ).delayMs,
    ).toBe(10 * MINUTE);
  });

  it('leaves the managers out when the rule has no in-app channel', () => {
    const plan = periodicAlertPlan(rule({ channels: [] }));
    expect(plan.enabled).toBe(true);
    expect(plan.roles).toEqual([]);
    expect(plan.employeePush).toBe(true);
  });

  it('keeps exactly the roles the rule names', () => {
    expect(periodicAlertPlan(rule({ recipientRoles: ['owner'] })).roles).toEqual(['owner']);
  });

  it('has no employee push when the kind carries no fixed recipient', () => {
    expect(periodicAlertPlan(rule({ fixedRecipients: [] })).employeePush).toBe(false);
  });
});

describe('leadAlertPlan', () => {
  it('takes the kind default lead when the rule row carries none', () => {
    expect(leadAlertPlan(leadRule())).toEqual({
      enabled: true,
      leadMs: 30 * MINUTE,
      employeePush: true,
    });
  });

  it('takes the stored lead of the rule', () => {
    expect(leadAlertPlan(leadRule({ leadMinutes: 45 })).leadMs).toBe(45 * MINUTE);
  });

  it('keeps the stored lead of a closed rule so the suppression path knows it was overdue', () => {
    const closed = effectiveAlertRule(
      'SHIFT_ENDS_SOON',
      { enabled: false, recipientRoles: [], channels: [], delayMinutes: null, leadMinutes: 45 },
      null,
      null,
    );
    expect(leadAlertPlan(closed)).toEqual({
      enabled: false,
      leadMs: 45 * MINUTE,
      employeePush: false,
    });
  });

  it('closes the plan with the master switch and keeps the kind default lead', () => {
    const closed = effectiveAlertRule('SHIFT_ENDS_SOON', null, null, false);
    expect(leadAlertPlan(closed)).toEqual({
      enabled: false,
      leadMs: 30 * MINUTE,
      employeePush: false,
    });
  });

  it('has no employee push when the rule carries no fixed recipient', () => {
    expect(leadAlertPlan(leadRule({ fixedRecipients: [] })).employeePush).toBe(false);
  });
});

describe('employeePushRecipient', () => {
  const withPush = periodicAlertPlan(rule());
  const withoutPush = periodicAlertPlan(rule({ fixedRecipients: [] }));

  it('carries the employee user id when the fixed push is on', () => {
    expect(employeePushRecipient(withPush, 'user-1')).toBe('user-1');
  });

  it('gives nothing without an employee user', () => {
    expect(employeePushRecipient(withPush, null)).toBeNull();
  });

  it('gives nothing when the plan has no fixed push', () => {
    expect(employeePushRecipient(withoutPush, 'user-1')).toBeNull();
  });
});

it('the smallest delay a rule may carry is one minute', () => {
  expect(MIN_ALERT_DELAY_MS).toBe(MINUTE);
});

describe('alertRoles', () => {
  const open = { enabled: true, channels: ['IN_APP'] as const, recipientRoles: MANAGERS };

  it('keeps the roles of an open rule with the in-app channel', () => {
    expect(alertRoles(open)).toEqual(MANAGERS);
  });

  it('keeps the roles of an open rule whose only channel is email or WhatsApp', () => {
    expect(alertRoles({ ...open, channels: ['EMAIL'] })).toEqual(MANAGERS);
    expect(alertRoles({ ...open, channels: ['WHATSAPP'] })).toEqual(MANAGERS);
  });

  it('gives no roles when the rule is switched off', () => {
    expect(alertRoles({ ...open, enabled: false })).toEqual([]);
  });

  it('gives no roles when the master switch closed the rule', () => {
    const closed = effectiveAlertRule('ATTENDANCE_EXCEPTION', null, null, false);
    expect(alertRoles(closed)).toEqual([]);
  });

  it('gives no roles when the rule has no channel', () => {
    expect(alertRoles({ ...open, channels: [] })).toEqual([]);
  });
});

describe('alertOn', () => {
  it('is on for an open rule with any channel', () => {
    expect(alertOn({ enabled: true, channels: ['IN_APP'] })).toBe(true);
    expect(alertOn({ enabled: true, channels: ['EMAIL'] })).toBe(true);
  });

  it('is off for a closed rule or a rule without the channel', () => {
    expect(alertOn({ enabled: false, channels: ['IN_APP'] })).toBe(false);
    expect(alertOn({ enabled: true, channels: [] })).toBe(false);
    expect(
      alertOn(effectiveAlertRule('ATTENDANCE_EXCEPTION', null, null, false)),
    ).toBe(false);
  });
});
