import { t } from '@pospay/i18n';
import type postgres from 'postgres';
import { branchPlaceAdapter } from '../persistence/branch-place.adapter.ts';
import { shiftEndingSoonTransactions } from '../persistence/shift-ending-soon.transactions.ts';
import type { ShiftEndingSoonTransactions } from '../ports/shift-ending-soon.port.ts';
import { DetectShiftEndingSoon } from '../use-cases/detect-shift-ending-soon/detect-shift-ending-soon.ts';
import { saveRule, type RuleContext } from './alert-rule.helpers.ts';
import {
  MORNING_IN,
  breakNotReturnedFixture,
  type BreakNotReturnedFixture,
} from './break-not-returned.fixture.ts';
import { ROLE, type Tenant } from './not-clocked-in.fixture.ts';

// الوردية 10:00–18:00 بتوقيت الكويت (07:00–15:00Z) ومهلة 30 دقيقة، فالاستحقاق 14:30Z.
export const ENDS_SOON_REMIND_AT = new Date('2026-10-04T14:30:00.000Z');
export const ENDS_SOON_LATE_AT = new Date('2026-10-04T14:50:00.000Z');
export const ENDS_SOON_BEFORE = new Date('2026-10-04T14:29:59.000Z');

const NAME_FALLBACK = {
  employeeAr: t('ar', 'inApp.generic_employee'),
  employeeEn: t('en', 'inApp.generic_employee'),
  branchAr: t('ar', 'inApp.generic_branch'),
  branchEn: t('en', 'inApp.generic_branch'),
};

/** قيم قاعدة «دوامك قرب يخلص»: التشغيل، والوقت المسبق، ونطاق القاعدة. */
export interface EndsSoonRuleValues {
  readonly enabled: boolean;
  readonly leadMinutes?: number | null;
  readonly branchId?: string | null;
}

/** ما يضيفه فكسشر التذكير فوق فكسشر البريك. */
export interface EndsSoonExtras {
  readonly endsSoonFailures: unknown[];
  readonly endsSoonTransactions: ShiftEndingSoonTransactions;
  readonly ruleContext: RuleContext;
  setNow(at: Date): void;
  detectEndsSoon(port?: ShiftEndingSoonTransactions): DetectShiftEndingSoon;
  atWork(tenant: Tenant): Promise<{ employee: string; userId: string; shiftId: string }>;
  endsSoonRule(tenant: Tenant, values: EndsSoonRuleValues): Promise<void>;
  endingNotices(company: string, employeeId: string): Promise<postgres.RowList<postgres.Row[]>>;
  endingEvents(company: string): Promise<postgres.RowList<postgres.Row[]>>;
}
export type ShiftEndingSoonFixture = BreakNotReturnedFixture & EndsSoonExtras;

/** فكسشر تذكير «دوامك قرب يخلص»: الموظفة الشغالة، وساعة التذكير، ودفتر انتهاء الوردية. */
export async function shiftEndingSoonFixture(): Promise<ShiftEndingSoonFixture> {
  const base = await breakNotReturnedFixture();
  const { owner, ids } = base;
  const transactions = shiftEndingSoonTransactions(base.db, ids, branchPlaceAdapter);
  let instant = ENDS_SOON_REMIND_AT;
  const failures: unknown[] = [];
  const clock = { now: () => new Date(instant) };
  const diagnostics = {
    failed: (_companyId: string, error: unknown) => {
      failures.push(error);
    },
  };
  const ruleContext: RuleContext = { owner, ids, userId: await base.user('rule-editor') };
  return {
    ...base,
    endsSoonFailures: failures,
    endsSoonTransactions: transactions,
    ruleContext,
    setNow: (at: Date) => {
      instant = at;
      base.setNow(at);
    },
    detectEndsSoon: (port: ShiftEndingSoonTransactions = transactions) =>
      new DetectShiftEndingSoon(port, clock, NAME_FALLBACK, diagnostics),
    atWork: async (tenant: Tenant) => {
      const userId = await base.user('mona');
      await base.member({
        tenant,
        userId,
        roleId: ROLE.cashier,
        scopeType: 'BRANCH',
        scopeId: tenant.branch,
      });
      const employee = await base.employee(tenant, { userId, nameEn: 'Mona', nameAr: 'منى' });
      const shiftId = await base.shift(tenant, employee);
      await base.session(tenant, employee, { clockIn: MORNING_IN });
      return { employee, userId, shiftId };
    },
    endsSoonRule: async (tenant: Tenant, values: EndsSoonRuleValues) => {
      await saveRule(
        ruleContext,
        { company: tenant.company, business: tenant.business, branchId: values.branchId ?? null },
        'SHIFT_ENDS_SOON',
        {
          enabled: values.enabled,
          roles: [],
          channels: [],
          delayMinutes: null,
          leadMinutes: values.leadMinutes ?? null,
        },
      );
    },
    endingNotices: (company: string, employeeId: string) =>
      owner`SELECT id, recipient_count, suppressed_at, notified_at, shift_starts_at, shift_ends_at, remind_due_at
        FROM attendance_shift_ending_notices
        WHERE company_id=${company} AND employee_id=${employeeId} ORDER BY shift_ends_at`,
    endingEvents: (company: string) =>
      owner`SELECT id, payload FROM outbox WHERE company_id=${company} AND event_type='ShiftEndsSoon' ORDER BY seq`,
  };
}
