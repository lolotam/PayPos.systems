import { effectiveAlertRule, type EffectiveAlertRule } from '@pospay/domain';
import { describe, expect, it } from 'vitest';
import { bellDelivery } from '../alert-rule-bell.ts';

const MANAGERS = ['owner', 'general_manager', 'business_manager', 'branch_manager'] as const;

const rule = (over: Partial<EffectiveAlertRule> = {}): EffectiveAlertRule => ({
  kind: 'LATE_SERVICE_SESSION',
  source: 'DEFAULT',
  enabled: true,
  recipientRoles: MANAGERS,
  channels: ['IN_APP'],
  fixedRecipients: [],
  masterOff: false,
  delayMinutes: null,
  leadMinutes: null,
  ...over,
});

const cases: readonly {
  readonly name: string;
  readonly rule: EffectiveAlertRule;
  readonly roles: readonly string[];
  readonly channel: 'IN_APP' | null;
}[] = [
  {
    name: 'the default rule rings the four managers in app',
    rule: rule(),
    roles: MANAGERS,
    channel: 'IN_APP',
  },
  {
    name: 'a closed rule rings nobody',
    rule: rule({ enabled: false }),
    roles: [],
    channel: null,
  },
  {
    name: 'a rule without an in-app channel rings nobody',
    rule: rule({ channels: [] }),
    roles: [],
    channel: null,
  },
  {
    name: 'a rule with one role rings only that role',
    rule: rule({ recipientRoles: ['owner'] }),
    roles: ['owner'],
    channel: 'IN_APP',
  },
  {
    name: 'a rule without roles rings nobody but keeps the channel',
    rule: rule({ recipientRoles: [] }),
    roles: [],
    channel: 'IN_APP',
  },
];

describe('bellDelivery', () => {
  for (const row of cases)
    it(row.name, () => {
      expect(bellDelivery(row.rule)).toEqual({ roles: row.roles, channel: row.channel });
    });

  it('the code default of every orders bell is the four manager roles in app', () => {
    for (const kind of [
      'LATE_SERVICE_SESSION',
      'SERVICE_LINE_EDITED',
      'SERVICE_LINE_CANCELLED',
      'SERVICE_LINE_PERFORMERS_CHANGED',
    ] as const)
      expect(bellDelivery(effectiveAlertRule(kind, null, null, null))).toEqual({
        roles: MANAGERS,
        channel: 'IN_APP',
      });
  });

  it('the source, the master switch and the fixed recipients do not change the delivery', () => {
    const base = rule();
    const business = rule({
      source: 'BUSINESS',
      masterOff: true,
      fixedRecipients: [{ selector: 'CONTEXT', who: 'REQUESTER' }],
    });
    const branch = rule({
      source: 'BRANCH',
      masterOff: true,
      fixedRecipients: [{ selector: 'PERMISSION_HOLDERS', permission: 'read:files:business' }],
    });
    expect(bellDelivery(business)).toEqual(bellDelivery(base));
    expect(bellDelivery(branch)).toEqual(bellDelivery(base));
  });
});
