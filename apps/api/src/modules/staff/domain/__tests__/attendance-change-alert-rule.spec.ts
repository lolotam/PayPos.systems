import { expect, it } from 'vitest';
import {
  effectiveAlertRule,
  type AlertRuleSettings,
  type EffectiveAlertRule,
} from '@pospay/domain';
import {
  attendanceChangeAlertPlan,
  type AttendanceChangeAlertKind,
  type AttendanceChangeAlertPlan,
} from '../attendance-change-alert-rule.ts';

const settings = (change: Partial<AlertRuleSettings> = {}): AlertRuleSettings => ({
  enabled: true,
  recipientRoles: [],
  channels: ['IN_APP'],
  delayMinutes: null,
  leadMinutes: null,
  ...change,
});

const NOTHING: AttendanceChangeAlertPlan = { resolveRecipients: false, channel: null };
const IN_APP: AttendanceChangeAlertPlan = { resolveRecipients: true, channel: 'IN_APP' };

const requestedDefault = effectiveAlertRule('ATTENDANCE_CHANGE_REQUESTED', null, null, null);
const decidedDefault = effectiveAlertRule('ATTENDANCE_CHANGE_DECIDED', null, null, null);
const withRoles: AlertRuleSettings = { ...settings(), recipientRoles: ['owner'] };

const cases: [string, EffectiveAlertRule, AttendanceChangeAlertKind, AttendanceChangeAlertPlan][] = [
  ['the default rule of the request kind', requestedDefault, 'ATTENDANCE_CHANGE_REQUESTED', IN_APP],
  ['the default rule of the decision kind', decidedDefault, 'ATTENDANCE_CHANGE_DECIDED', IN_APP],
  [
    'a switched-off kind',
    effectiveAlertRule('ATTENDANCE_CHANGE_REQUESTED', settings({ enabled: false }), null, null),
    'ATTENDANCE_CHANGE_REQUESTED',
    NOTHING,
  ],
  [
    'the master switch off',
    effectiveAlertRule('ATTENDANCE_CHANGE_REQUESTED', null, null, false),
    'ATTENDANCE_CHANGE_REQUESTED',
    NOTHING,
  ],
  [
    'the master switch off on the decision kind',
    effectiveAlertRule('ATTENDANCE_CHANGE_DECIDED', null, null, false),
    'ATTENDANCE_CHANGE_DECIDED',
    NOTHING,
  ],
  [
    'a kind with no channel',
    effectiveAlertRule('ATTENDANCE_CHANGE_REQUESTED', settings({ channels: [] }), null, null),
    'ATTENDANCE_CHANGE_REQUESTED',
    NOTHING,
  ],
  [
    'a kind with no channel on the decision kind',
    effectiveAlertRule('ATTENDANCE_CHANGE_DECIDED', settings({ channels: [] }), null, null),
    'ATTENDANCE_CHANGE_DECIDED',
    NOTHING,
  ],
  [
    'a rule without the selector the request kind needs',
    decidedDefault,
    'ATTENDANCE_CHANGE_REQUESTED',
    NOTHING,
  ],
  [
    'a rule without the selector the decision kind needs',
    requestedDefault,
    'ATTENDANCE_CHANGE_DECIDED',
    NOTHING,
  ],
  [
    'a stored rule with roles and the fixed selector of the request kind',
    effectiveAlertRule('ATTENDANCE_CHANGE_REQUESTED', withRoles, null, null),
    'ATTENDANCE_CHANGE_REQUESTED',
    IN_APP,
  ],
];

it.each(cases)('%s', (_name, rule, kind, plan) => {
  expect(attendanceChangeAlertPlan(rule, kind)).toEqual(plan);
});

it('a closed rule carries no fixed recipients and no channel', () => {
  const closed = effectiveAlertRule('ATTENDANCE_CHANGE_REQUESTED', null, null, false);
  expect(closed).toMatchObject({
    enabled: false,
    masterOff: true,
    recipientRoles: [],
    channels: [],
    fixedRecipients: [],
  });
  expect(attendanceChangeAlertPlan(closed, 'ATTENDANCE_CHANGE_REQUESTED')).toEqual(NOTHING);
});
