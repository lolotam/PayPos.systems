import { expect, it } from 'vitest';
import {
  effectiveAlertRule,
  type AlertRuleSettings,
  type EffectiveAlertRule,
} from '@pospay/domain';
import {
  attendanceChangeAlertPlan,
  attendanceChangeNoticeParameters,
  attendanceChangeRoleRecipients,
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

const NOTHING: AttendanceChangeAlertPlan = { fixed: false, channel: null, roles: [] };
const FIXED: AttendanceChangeAlertPlan = { fixed: true, channel: 'IN_APP', roles: [] };
const NO_FIXED: AttendanceChangeAlertPlan = { fixed: false, channel: 'IN_APP', roles: [] };
const FIXED_WITH_ROLE: AttendanceChangeAlertPlan = {
  fixed: true,
  channel: 'IN_APP',
  roles: ['owner'],
};
const ROLES_ONLY: AttendanceChangeAlertPlan = {
  fixed: false,
  channel: 'IN_APP',
  roles: ['branch_manager'],
};

const requestedDefault = effectiveAlertRule('ATTENDANCE_CHANGE_REQUESTED', null, null, null);
const decidedDefault = effectiveAlertRule('ATTENDANCE_CHANGE_DECIDED', null, null, null);
const withRoles: AlertRuleSettings = { ...settings(), recipientRoles: ['owner'] };

const cases: [string, EffectiveAlertRule, AttendanceChangeAlertKind, AttendanceChangeAlertPlan][] = [
  ['the default rule of the request kind', requestedDefault, 'ATTENDANCE_CHANGE_REQUESTED', FIXED],
  ['the default rule of the decision kind', decidedDefault, 'ATTENDANCE_CHANGE_DECIDED', FIXED],
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
    NO_FIXED,
  ],
  [
    'a rule without the selector the decision kind needs',
    requestedDefault,
    'ATTENDANCE_CHANGE_DECIDED',
    NO_FIXED,
  ],
  [
    'a stored rule with roles and the fixed selector of the request kind',
    effectiveAlertRule('ATTENDANCE_CHANGE_REQUESTED', withRoles, null, null),
    'ATTENDANCE_CHANGE_REQUESTED',
    FIXED_WITH_ROLE,
  ],
  [
    'roles without the selector the request kind needs',
    effectiveAlertRule(
      'ATTENDANCE_CHANGE_DECIDED',
      settings({ recipientRoles: ['branch_manager'] }),
      null,
      null,
    ),
    'ATTENDANCE_CHANGE_REQUESTED',
    ROLES_ONLY,
  ],
  [
    'roles on a switched-off kind',
    effectiveAlertRule(
      'ATTENDANCE_CHANGE_REQUESTED',
      settings({ enabled: false, recipientRoles: ['branch_manager'] }),
      null,
      null,
    ),
    'ATTENDANCE_CHANGE_REQUESTED',
    NOTHING,
  ],
  [
    'roles on a kind with no channel',
    effectiveAlertRule(
      'ATTENDANCE_CHANGE_REQUESTED',
      settings({ channels: [], recipientRoles: ['branch_manager'] }),
      null,
      null,
    ),
    'ATTENDANCE_CHANGE_REQUESTED',
    NOTHING,
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

it('the default rules of both kinds read no roles', () => {
  expect(attendanceChangeAlertPlan(requestedDefault, 'ATTENDANCE_CHANGE_REQUESTED').roles).toEqual([]);
  expect(attendanceChangeAlertPlan(decidedDefault, 'ATTENDANCE_CHANGE_DECIDED').roles).toEqual([]);
});

it('drops the acting user and the employee, and keeps the owner', () => {
  const holders = [
    { userId: 'actor', owner: false },
    { userId: 'employee', owner: false },
    { userId: 'owner', owner: true },
    { userId: 'other', owner: false },
  ];
  expect(attendanceChangeRoleRecipients(holders, 'actor', 'employee')).toEqual(['owner', 'other']);
  expect(attendanceChangeRoleRecipients(holders, 'actor', 'owner')).toEqual([
    'employee',
    'owner',
    'other',
  ]);
  expect(attendanceChangeRoleRecipients(holders, 'nobody', 'nobody')).toEqual([
    'actor',
    'employee',
    'owner',
    'other',
  ]);
  expect(attendanceChangeRoleRecipients([], 'actor', 'employee')).toEqual([]);
});

it('gives the decision reason to the requester only', () => {
  const safe = { employee_name_ar: 'Employee', employee_name_en: 'Employee', reason: 'wrong day' };
  const request = { kind: 'ADD_SESSION', status: 'REJECTED', requested_by: 'requester' };
  const names = [
    { name: 'employee_name_ar', type: 'text', value: 'Employee' },
    { name: 'employee_name_en', type: 'text', value: 'Employee' },
    { name: 'change', type: 'text', value: 'ADD_SESSION' },
  ];
  expect(attendanceChangeNoticeParameters(safe, request, 'requester')).toEqual([
    ...names,
    { name: 'decision', type: 'text', value: 'REJECTED' },
    { name: 'reason', type: 'text', value: 'wrong day' },
  ]);
  expect(attendanceChangeNoticeParameters(safe, request, 'other')).toEqual([
    ...names,
    { name: 'decision', type: 'text', value: 'REJECTED' },
    { name: 'reason', type: 'text', value: '-' },
  ]);
  expect(attendanceChangeNoticeParameters(safe, { ...request, status: 'PENDING' }, 'other')).toEqual(
    names,
  );
});
