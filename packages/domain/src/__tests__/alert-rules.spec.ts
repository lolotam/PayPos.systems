import { describe, expect, it } from 'vitest';
import {
  ALERT_CHANNELS,
  ALERT_KIND_DEFINITIONS,
  alertKindAllowsBranchOverride,
  ALERT_KINDS,
  alertRuleViolation,
  effectiveAlertRule,
  resolveAlertRule,
  sameAlertRuleSettings,
  TEAM_ALERT_REQUIRE_VERIFIED_EMAIL,
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

describe('resolveAlertRule', () => {
  it('the branch rule wins whole, then the business rule, then the kind default', () => {
    const business = rule({ delayMinutes: 20 });
    const branch = rule({ delayMinutes: 10, enabled: false });
    expect(resolveAlertRule('SHIFT_NOT_CLOCKED_IN', business, branch)).toEqual({
      source: 'BRANCH',
      settings: branch,
    });
    expect(resolveAlertRule('SHIFT_NOT_CLOCKED_IN', business, null)).toEqual({
      source: 'BUSINESS',
      settings: business,
    });
  });

  it('no stored rule gives the AL-Q5 default of the kind', () => {
    for (const kind of ALERT_KINDS) {
      const resolved = resolveAlertRule(kind, null, null);
      expect(resolved.source).toBe('DEFAULT');
      expect(resolved.settings).toEqual(ALERT_KIND_DEFINITIONS[kind].defaults);
    }
  });

  it('the master switch is not applied here — it sits above the resolved rule', () => {
    const resolved = resolveAlertRule('SHIFT_NOT_CLOCKED_IN', rule({ enabled: true }), null);
    expect(resolved.settings.enabled).toBe(true);
    expect(resolved.source).toBe('BUSINESS');
  });
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

describe('alert channels (AL-Q6, row 62b-1)', () => {
  it('offers the in-app, email and WhatsApp channels, in that order', () => {
    expect([...ALERT_CHANNELS]).toEqual(['IN_APP', 'EMAIL', 'WHATSAPP']);
  });

  it('accepts email and WhatsApp on a manager kind, alone or together with the in-app channel', () => {
    for (const channels of [['EMAIL'], ['WHATSAPP'], ['IN_APP', 'EMAIL', 'WHATSAPP']] as const) {
      expect(alertRuleViolation('ATTENDANCE_EXCEPTION', rule({ channels }))).toBeNull();
    }
  });

  it('refuses a duplicated email or WhatsApp channel', () => {
    for (const channel of ['EMAIL', 'WHATSAPP'] as const) {
      expect(
        alertRuleViolation('ATTENDANCE_EXCEPTION', rule({ channels: [channel, channel] })),
      ).toBe('DUPLICATE_VALUE');
    }
  });

  it('refuses any channel on the employee-only kind, the new ones included', () => {
    for (const channel of ['IN_APP', 'EMAIL', 'WHATSAPP'] as const) {
      expect(
        alertRuleViolation(
          'SHIFT_ENDS_SOON',
          rule({ recipientRoles: [], leadMinutes: 30, channels: [channel] }),
        ),
      ).toBe('CHANNELS_NOT_ALLOWED');
    }
  });

  it('keeps every default in-app only, so nothing starts sending email or WhatsApp by itself', () => {
    for (const kind of ALERT_KINDS) {
      const definition = ALERT_KIND_DEFINITIONS[kind];
      expect(definition.defaults.channels).toEqual(definition.employeeOnly ? [] : ['IN_APP']);
    }
  });

  it('compares two rules by channel set regardless of order', () => {
    expect(
      sameAlertRuleSettings(rule({ channels: ['EMAIL', 'IN_APP'] }), rule({ channels: ['IN_APP', 'EMAIL'] })),
    ).toBe(true);
    expect(sameAlertRuleSettings(rule({ channels: ['IN_APP'] }), rule({ channels: ['IN_APP', 'EMAIL'] }))).toBe(false);
  });

  it('requires a verified email by default until the owner confirms GR-003(d)', () => {
    expect(TEAM_ALERT_REQUIRE_VERIFIED_EMAIL).toBe(true);
  });
});

describe('alertRuleViolation: branch manager on statement kinds (issue #486)', () => {
  const STATEMENT_KINDS = ['STATEMENT_AWAITING_REVIEW', 'STATEMENT_AWAITING_APPROVAL'] as const;

  it('refuses the branch manager on every statement kind, alone or with other roles', () => {
    for (const kind of STATEMENT_KINDS) {
      expect(alertRuleViolation(kind, rule({ recipientRoles: ['branch_manager'] }))).toBe(
        'ROLE_NOT_ALLOWED_FOR_KIND',
      );
      expect(alertRuleViolation(kind, rule({ recipientRoles: ['owner', 'branch_manager'] }))).toBe(
        'ROLE_NOT_ALLOWED_FOR_KIND',
      );
    }
  });

  it('still accepts the other three roles and an empty list on the statement kinds', () => {
    for (const kind of STATEMENT_KINDS) {
      expect(
        alertRuleViolation(
          kind,
          rule({ recipientRoles: ['owner', 'general_manager', 'business_manager'] }),
        ),
      ).toBeNull();
      expect(alertRuleViolation(kind, rule({ recipientRoles: [] }))).toBeNull();
    }
  });

  it('keeps accepting the branch manager on every other kind that takes roles', () => {
    const refused = new Set<string>(STATEMENT_KINDS);
    for (const kind of ALERT_KINDS) {
      const definition = ALERT_KIND_DEFINITIONS[kind];
      if (refused.has(kind) || definition.employeeOnly) continue;
      const settings = {
        ...ALERT_KIND_DEFINITIONS[kind].defaults,
        recipientRoles: ['branch_manager'] as const,
      };
      expect(alertRuleViolation(kind, settings)).toBeNull();
    }
  });

  it('declares the refused role on exactly the two statement kinds', () => {
    const declared = ALERT_KINDS.filter(
      (kind) => ALERT_KIND_DEFINITIONS[kind].refusedRecipientRoles.length > 0,
    );
    expect(declared).toEqual([...STATEMENT_KINDS]);
  });
});

describe('sameAlertRuleSettings', () => {
  it('ignores role order and sees every field change', () => {
    expect(sameAlertRuleSettings(rule(), rule({ recipientRoles: ['branch_manager', 'owner'] }))).toBe(true);
    expect(sameAlertRuleSettings(rule(), rule({ enabled: false }))).toBe(false);
    expect(sameAlertRuleSettings(rule(), rule({ recipientRoles: ['owner'] }))).toBe(false);
    expect(sameAlertRuleSettings(rule(), rule({ channels: [] }))).toBe(false);
    expect(sameAlertRuleSettings(rule({ delayMinutes: 10 }), rule({ delayMinutes: 20 }))).toBe(false);
    expect(sameAlertRuleSettings(rule({ leadMinutes: 10 }), rule({ leadMinutes: null }))).toBe(false);
  });
});

describe('alertKindAllowsBranchOverride', () => {
  it('kinds without a branch never take a branch override', () => {
    for (const kind of ['DOCUMENT_EXPIRING', 'STATEMENT_AWAITING_REVIEW', 'STATEMENT_AWAITING_APPROVAL'] as const)
      expect(alertKindAllowsBranchOverride(kind)).toBe(false);
    expect(alertKindAllowsBranchOverride('SHIFT_NOT_CLOCKED_IN')).toBe(true);
  });
});

describe('DISCOUNT_SELF_APPROVED', () => {
  it('effective default rule has owner in-app bell enabled', () => {
    expect(effectiveAlertRule('DISCOUNT_SELF_APPROVED', null, null, null)).toMatchObject({
      source: 'DEFAULT',
      enabled: true,
      recipientRoles: ['owner'],
      channels: ['IN_APP'],
      delayMinutes: null,
      leadMinutes: null,
      fixedRecipients: [],
    });
  });

  it('allows branch-level override', () => {
    expect(alertKindAllowsBranchOverride('DISCOUNT_SELF_APPROVED')).toBe(true);
  });
});

describe('LOW_RATING', () => {
  it('the RT-Q8 default: on, in-app, the four managers, branch override allowed, no fixed recipient', () => {
    expect(ALERT_KINDS).toContain('LOW_RATING');
    expect(effectiveAlertRule('LOW_RATING', null, null, null)).toMatchObject({
      kind: 'LOW_RATING',
      source: 'DEFAULT',
      enabled: true,
      masterOff: false,
      recipientRoles: ['owner', 'general_manager', 'business_manager', 'branch_manager'],
      channels: ['IN_APP'],
      delayMinutes: null,
      leadMinutes: null,
      fixedRecipients: [],
    });
    expect(alertKindAllowsBranchOverride('LOW_RATING')).toBe(true);
  });

  it('a branch rule replaces the default whole and the master switch empties it', () => {
    const branch = rule({ enabled: false, recipientRoles: ['branch_manager'] });
    const overridden = effectiveAlertRule('LOW_RATING', null, branch, null);
    expect(overridden.source).toBe('BRANCH');
    expect(overridden.enabled).toBe(false);
    expect(overridden.recipientRoles).toEqual([]);
    expect(overridden.channels).toEqual([]);
    expect(overridden.fixedRecipients).toEqual([]);
    expect(effectiveAlertRule('LOW_RATING', null, null, false).masterOff).toBe(true);
  });

  it('a delay or lead is not part of this kind and is refused (FR-B16)', () => {
    expect(alertRuleViolation('LOW_RATING', rule({ delayMinutes: 5 }))).toBe('DELAY_NOT_ALLOWED');
    expect(alertRuleViolation('LOW_RATING', rule({ leadMinutes: 5 }))).toBe('LEAD_NOT_ALLOWED');
    expect(alertRuleViolation('LOW_RATING', rule())).toBeNull();
  });
});
