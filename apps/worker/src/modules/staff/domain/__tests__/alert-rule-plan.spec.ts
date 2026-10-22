import { effectiveAlertRule } from '@pospay/domain';
import { describe, expect, it } from 'vitest';
import {
  MIN_ALERT_DELAY_MS,
  employeePushRecipient,
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

describe('periodicAlertPlan', () => {
  it('reads the delay, the roles and the fixed employee push off an open rule', () => {
    expect(periodicAlertPlan(rule())).toEqual({
      enabled: true,
      delayMs: 20 * MINUTE,
      roles: MANAGERS,
      employeePush: true,
    });
  });

  it('keeps the stored delay of a closed rule so the suppression path knows it was overdue', () => {
    expect(periodicAlertPlan(rule({ enabled: false }))).toEqual({
      enabled: false,
      delayMs: 20 * MINUTE,
      roles: [],
      employeePush: false,
    });
  });

  it('closes the plan with the master switch and falls back to the kind default delay', () => {
    const closed = effectiveAlertRule('SHIFT_NOT_CLOCKED_IN', null, null, false);
    expect(periodicAlertPlan(closed)).toEqual({
      enabled: false,
      delayMs: 20 * MINUTE,
      roles: [],
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
