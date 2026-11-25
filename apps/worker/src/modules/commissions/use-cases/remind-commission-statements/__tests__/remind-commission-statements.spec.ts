import { describe, expect, it } from 'vitest';
import type { EffectiveAlertRule } from '@pospay/domain';

import type {
  NoticeEventInput,
  ReminderLedgerInput,
  StatementReminderScope,
  StatementReminderTransactions,
} from '../../../ports/statement-reminder.port.ts';
import { remindCommissionStatements } from '../remind-commission-statements.ts';

const COMPANY = 'company-1';
const BUSINESS = 'business-1';

const rule = (enabled: boolean): EffectiveAlertRule =>
  ({
    kind: 'STATEMENT_AWAITING_APPROVAL',
    enabled,
    channels: enabled ? ['IN_APP'] : [],
    recipientRoles: [],
    delayMinutes: null,
    leadMinutes: null,
    source: 'DEFAULT',
  }) as unknown as EffectiveAlertRule;

/** حالة الفحص: القواعد والمستلمون والمفتاح وسطر الدفتر. */
interface Harness {
  readonly featureEnabled: boolean;
  readonly status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';
  readonly approvalRuleEnabled: boolean;
  readonly reviewRuleEnabled: boolean;
  readonly switchOn: boolean;
  readonly approvers: readonly string[];
  readonly reviewers: readonly string[];
  readonly ledger: ReminderLedgerInput[];
  readonly events: NoticeEventInput[];
  readonly inserted: boolean;
}

function harness(patch: Partial<Harness> = {}): Harness {
  return {
    featureEnabled: true,
    status: 'DRAFT',
    approvalRuleEnabled: true,
    reviewRuleEnabled: true,
    switchOn: true,
    approvers: ['approver-1'],
    reviewers: ['reviewer-1'],
    ledger: [],
    events: [],
    inserted: true,
    ...patch,
  };
}

/** يبني حد المعاملة من حالة الفحص. */
function transactionsOf(state: Harness): StatementReminderTransactions {
  const scope: StatementReminderScope = {
    featureEnabled: async () => state.featureEnabled,
    decisionTime: async () => new Date('2026-11-03T06:00:00Z'),
    alertRule: async (_businessId, kind) =>
      rule(
        kind === 'STATEMENT_AWAITING_APPROVAL'
          ? state.approvalRuleEnabled
          : state.reviewRuleEnabled,
      ),
    switchEnabled: async () => state.switchOn,
    recipients: async (_businessId, permission) =>
      permission === 'approve:commissions:business' ? state.approvers : state.reviewers,
    lockPeriod: async () => ({
      statementId: 'statement-1',
      status: state.status,
    }),
    insertLedger: async (input) => {
      if (!state.inserted) return false;
      state.ledger.push(input);
      return true;
    },
    appendNoticeEvents: async (input) => {
      state.events.push(input);
      return 1;
    },
  };
  return {
    businesses: async () => [{ id: BUSINESS, timeZone: 'Asia/Kuwait' }],
    run: async (_companyId, work) => work(scope),
  };
}

const clock = (iso: string) => ({ now: () => new Date(iso) });

describe('remindCommissionStatements — day three and five', () => {
  it('sends the day-three approval and review notices on the third', async () => {
    const state = harness();
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result).toEqual({ businesses: 1, reminders: 2 });
    expect(state.ledger.map((row) => row.kind)).toEqual(['APPROVAL_DAY3', 'REVIEW_DAY3']);
    expect(state.ledger[0]?.reminderDate).toBe('2026-11-03');
    expect(state.events.map((event) => event.templateKey)).toEqual([
      'statement_awaiting_approval',
      'statement_awaiting_review',
    ]);
    expect(state.events[0]?.recipients).toEqual(['approver-1']);
    expect(state.events[1]?.recipients).toEqual(['reviewer-1']);
  });

  it('sends the day-five approval notice only', async () => {
    const state = harness();
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-05T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(1);
    expect(state.ledger.map((row) => row.kind)).toEqual(['APPROVAL_DAY5']);
    expect(state.events.map((event) => event.templateKey)).toEqual([
      'statement_awaiting_approval',
    ]);
  });

  it('targets the previous month', async () => {
    const state = harness();
    await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );
    expect(state.events[0]?.period).toBe('2026-10');
  });

});

describe('remindCommissionStatements — what is not sent', () => {
  it('writes nothing before nine in the business morning', async () => {
    const state = harness();
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T05:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(0);
    expect(state.ledger).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it('writes nothing when the commissions feature is off (CM-57)', async () => {
    const state = harness({ featureEnabled: false });
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(0);
    expect(state.ledger).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it('sends nothing to a closed statement', async () => {
    const state = harness({ status: 'APPROVED' });
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(0);
    expect(state.ledger).toEqual([]);
  });

  it('sends the approval notice on a reviewed statement but no review notice', async () => {
    const state = harness({ status: 'REVIEWED' });
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(1);
    expect(state.ledger.map((row) => row.kind)).toEqual(['APPROVAL_DAY3']);
  });

});

describe('remindCommissionStatements — recipients and switches', () => {
  it('sends no approval notice while the explicit approval switch is off', async () => {
    const state = harness({ switchOn: false });
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(1);
    expect(state.ledger.map((row) => row.kind)).toEqual(['REVIEW_DAY3']);
    expect(state.events.map((event) => event.templateKey)).toEqual([
      'statement_awaiting_review',
    ]);
  });

  it('sends no approval notice while the approval alert rule is off', async () => {
    const state = harness({ approvalRuleEnabled: false });
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(1);
    expect(state.ledger.map((row) => row.kind)).toEqual(['REVIEW_DAY3']);
  });

  it('records a durable zero-recipient decision and emits no event', async () => {
    const state = harness({ approvers: [], reviewers: [] });
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(2);
    expect(state.ledger.map((row) => row.recipientCount)).toEqual([0, 0]);
    expect(state.events).toEqual([]);
  });

  it('sends nothing when the ledger row already exists for the day', async () => {
    const state = harness({ inserted: false });
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(0);
    expect(state.events).toEqual([]);
  });
});

describe('remindCommissionStatements — alert rules (RT-26)', () => {
  it('sends no review notice while the review alert rule is off (RT-26)', async () => {
    const state = harness({ reviewRuleEnabled: false });
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(1);
    expect(state.ledger.map((row) => row.kind)).toEqual(['APPROVAL_DAY3']);
    expect(state.events.map((event) => event.templateKey)).toEqual([
      'statement_awaiting_approval',
    ]);
  });

  it('sends no notice at all while both statement alert rules are off (RT-26)', async () => {
    const state = harness({ approvalRuleEnabled: false, reviewRuleEnabled: false });
    const result = await remindCommissionStatements(
      { transactions: transactionsOf(state), clock: clock('2026-11-03T06:00:00Z') },
      COMPANY,
    );

    expect(result.reminders).toBe(0);
    expect(state.ledger).toEqual([]);
    expect(state.events).toEqual([]);
  });
});
