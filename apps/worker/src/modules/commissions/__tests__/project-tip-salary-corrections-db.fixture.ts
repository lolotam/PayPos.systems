import type { ClaimedEvent } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  COMMISSION_LINE_IDS,
  insertCommissionLineProjection,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import {
  insertCommissionAttachment,
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import type { CommissionInputUseCases } from '../events/handlers/on-commission-input-event.handler.ts';
import { onCommissionInputEvent } from '../events/handlers/on-commission-input-event.handler.ts';
import { createCommissionCorrectionScope } from '../persistence/commission-correction.scope.ts';
import {
  createCommissionSalaryProjectionScope,
  createCommissionTipProjectionScope,
  type BusinessCalendarReader,
  type EmployeeBusinessReader,
} from '../persistence/commission-tip-salary-projection.scope.ts';
import { ProjectSalary } from '../use-cases/project-salary/project-salary.ts';
import { ProjectSessionTips } from '../use-cases/project-session-tips/project-session-tips.ts';
import {
  A,
  consumerWithClock,
  CURRENT,
  db,
  deliverAt,
  ids,
  owner,
  SOURCE_PERIOD,
} from './project-service-lines-corrections-db.fixture.ts';
import {
  commissionSalaryEvent,
  commissionTipEvent,
  type CommissionSalaryEventOverrides,
  type CommissionTipEventOverrides,
} from './commission-tip-salary-events.ts';
import { noCommissionBlockNotices } from './commission-block-notice.fakes.ts';
import { businessTimeZone } from './project-service-lines-corrections-db.fixture.ts';

export * from './project-service-lines-corrections-db.fixture.ts';

/** خطة المثال المحسوب: شرط واحد من مضاعف راتب 1.00 يدفع 10% فوق الحد. */
export const SALARY_THRESHOLD_PLAN = {
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'SALARY_MULTIPLE', value: '1.00' }, calc: { kind: 'PCT', bps: 1000 } }],
  },
  package_sale: { enabled: false },
} as const;

export const tipHeads =
  () => owner`SELECT session_id,revision,period,business_date::text AS business_date
  FROM commission_tip_heads ORDER BY session_id`;
export const tipRows = () => owner`SELECT employee_id,method,amount FROM commission_tips
  ORDER BY employee_id,method`;
export const salaryRows = () => owner`SELECT employee_id,effective_from::text AS effective_from,
  amount,revision FROM commission_salaries ORDER BY employee_id,effective_from`;

export const tipEvent = (overrides: CommissionTipEventOverrides = {}): ClaimedEvent =>
  commissionTipEvent(A, ids, overrides);
export const salaryEvent = (overrides: CommissionSalaryEventOverrides = {}): ClaimedEvent =>
  commissionSalaryEvent(A, ids, overrides);

// قارئا الاختبار هما نفس قرّاء tenancy و staff بواجهة المنفذ؛ تعريف محلي يمنع اختبار
// موديول commissions من استيراد موديول آخر، على نفس الجدولين والأعمدة.
const businessCalendarReader: BusinessCalendarReader = async (tx, companyId, businessId) => {
  const [row] = await tx.execute<{ timezone: string; created_at: string }>(
    sql`SELECT timezone, created_at FROM businesses WHERE company_id=${companyId} AND id=${businessId}`,
  );
  return row === undefined ? null : { timeZone: row.timezone, createdAt: new Date(row.created_at) };
};
const employeeBusinessReader: EmployeeBusinessReader = async (tx, companyId, employeeId) => {
  const [row] = await tx.execute<{ business_id: string }>(
    sql`SELECT business_id FROM employees WHERE company_id=${companyId} AND id=${employeeId}`,
  );
  return row?.business_id ?? null;
};

export async function insertCommissionSalary(
  employeeId: string,
  effectiveFrom: string,
  amount: string,
  revision = 1,
): Promise<void> {
  await owner`INSERT INTO commission_salaries(
    company_id,id,business_id,employee_id,effective_from,amount,revision)
    VALUES(${A.company},${ids.newId()},${A.business},${employeeId},${effectiveFrom}::date,${amount},${revision})`;
}

interface ClosedTipMonthOptions {
  readonly status?: 'APPROVED' | 'PAID';
  readonly method?: 'CARD' | 'CASH';
  readonly amount?: string;
  readonly withPlan?: boolean;
  readonly withLine?: boolean;
  readonly period?: string;
}

/** يزرع إسقاط بقشيش شهر مفتوح بمراجعة واحدة ويرجع مرجع مصدره. */
async function projectTipSession(
  period: string,
  method: 'CARD' | 'CASH',
  amount: string,
): Promise<string> {
  const sessionId = ids.newId();
  const initial = await deliverAt(
    CURRENT,
    tipEvent({
      sessionId,
      businessDate: `${period}-15`,
      revision: 1,
      tips: [{ employee_id: A.employee, method, amount }],
    }),
  );
  if (!initial.delivered) throw new Error('the source tip projection did not deliver');
  return sessionId;
}

/** يجمّد صف البقشيش وارتباط الموظفة على كشف الشهر بعد اعتماده. */
async function freezeTipStatement(
  period: string,
  status: 'APPROVED' | 'PAID',
  method: 'CARD' | 'CASH',
  sourceRef: string,
  amount: string,
): Promise<string> {
  return walkCommissionStatement(db, {
    tenant: A,
    period,
    ids,
    to: status,
    afterApproved: async (tx, id) => {
      await insertCommissionLine(tx, A, id, ids, {
        kind: method === 'CARD' ? 'TIP_CARD' : 'TIP_CASH',
        sourceRef,
        amount,
        sourceBranchId: A.branch,
        sourceBusinessDate: `${period}-15`,
        attachedBranchIds: [A.branch],
      });
      await insertCommissionAttachment(tx, A, id, ids, { employeeId: A.employee });
    },
  });
}

/** بذر شهر مغلق بقشيش مجمّد عليه: يزرع إسقاط البقشيش ثم يمشي الكشف ويجمّد صف البقشيش. */
export async function seedClosedTipMonth(options: ClosedTipMonthOptions = {}): Promise<{
  statementId: string;
  sessionId: string;
  sourceRef: string;
}> {
  const period = options.period ?? SOURCE_PERIOD;
  const method = options.method ?? 'CARD';
  const amount = options.amount ?? '5.000';
  const sessionId = await projectTipSession(period, method, amount);
  const sourceRef = `tip:${sessionId}:${method}`;
  const statementId = await freezeTipStatement(
    period,
    options.status ?? 'APPROVED',
    method,
    sourceRef,
    amount,
  );
  if (options.withLine === true) {
    await db.withTenant(A.company, async (tx) => {
      await insertCommissionLineProjection(tx, A, ids, {
        lineId: COMMISSION_LINE_IDS.lineA,
        businessDate: `${period}-10`,
        occurredAt: `${period}-10T09:00:00Z`,
        recordedAt: `${period}-10T09:00:00Z`,
        period,
        net: '10.000',
        ruleKind: 'FOLLOW_PLAN',
      });
    });
  }
  if (options.withPlan !== false) {
    await db.withTenant(A.company, async (tx) => {
      await insertCommissionPlanVersion(tx, A, ids, {
        employeeId: A.employee,
        effectiveFrom: `${period}-01`,
        plan: {
          base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
          tiers: { enabled: false },
          package_sale: { enabled: false },
        },
      });
    });
  }
  return { statementId, sessionId, sourceRef };
}

/** يزرع خطة المثال المحسوب لسارة وراتبي 1 يناير و10 أبريل قبل أي حدث مختبر. */
export async function seedSalaryThresholdSetup(): Promise<void> {
  await db.withTenant(A.company, async (tx) => {
    await insertCommissionPlanVersion(tx, A, ids, {
      employeeId: A.employee,
      effectiveFrom: '2025-06-01',
      plan: SALARY_THRESHOLD_PLAN,
    });
  });
  await insertCommissionSalary(A.employee, '2026-01-01', '500.000');
  await insertCommissionSalary(A.employee, '2026-04-10', '600.000');
}

/** يذرع بنودا المثال المحسوب في إسقاط الشهر ويرجع مرجع بند L2. */
async function projectWorkedLines(period: string): Promise<string> {
  // لكل شهر بنوداه الخاصان: هوية البند رأس واحد لا يتكرر بين الشهور.
  const lineL1 = ids.newId();
  const lineL2 = ids.newId();
  await db.withTenant(A.company, async (tx) => {
    await insertCommissionLineProjection(tx, A, ids, {
      lineId: lineL1,
      businessDate: `${period}-10`,
      occurredAt: `${period}-10T09:00:00Z`,
      recordedAt: `${period}-10T09:00:00Z`,
      period,
      net: '400.000',
      ruleKind: 'FOLLOW_PLAN',
    });
    await insertCommissionLineProjection(tx, A, ids, {
      lineId: lineL2,
      businessDate: `${period}-20`,
      occurredAt: `${period}-20T09:00:00Z`,
      recordedAt: `${period}-20T09:00:00Z`,
      period,
      net: '300.000',
      ruleKind: 'FOLLOW_PLAN',
    });
  });
  return `line:${lineL2}`;
}

/** يذرع شهراً من المثال المحسوب: بنودا L1 وL2 في الإسقاط ثم صف L2 المجمّد 20.000 عند الاعتماد. */
export async function seedSalaryWorkedMonth(
  period: string,
  status: 'APPROVED' | 'REVIEWED' | 'PAID' = 'APPROVED',
): Promise<{ statementId: string; sourceRef: string }> {
  const sourceRef = await projectWorkedLines(period);
  if (status === 'REVIEWED') {
    const statementId = await walkCommissionStatement(db, {
      tenant: A,
      period,
      ids,
      to: 'REVIEWED',
    });
    return { statementId, sourceRef };
  }
  const statementId = await walkCommissionStatement(db, {
    tenant: A,
    period,
    ids,
    to: status,
    afterApproved: async (tx, id) => {
      await insertCommissionLine(tx, A, id, ids, {
        kind: 'COMMISSION',
        lineId: sourceRef.slice('line:'.length),
        sessionId: COMMISSION_LINE_IDS.sessionA,
        serviceId: A.service,
        customerId: A.customer,
        sourceRef,
        amount: '20.000',
        sourceBranchId: A.branch,
        sourceBusinessDate: `${period}-20`,
        businessDate: `${period}-20`,
        attachedBranchIds: [A.branch],
      });
      await insertCommissionAttachment(tx, A, id, ids, { employeeId: A.employee });
    },
  });
  return { statementId, sourceRef };
}

/** مستهلك تفشل كتابة تصحيحات البقشيش فيه بعد إعادة الحساب؛ CM-22 لمسار البقشيش. */
export function failingTipsCorrectionsConsumer(): OutboxConsumer {
  const clock = { now: () => new Date(CURRENT) };
  const standard = consumerWithClock(clock);
  return {
    id: standard.id,
    eventTypes: standard.eventTypes,
    handle: async (tx, event) => {
      const corrections = createCommissionCorrectionScope(tx, ids, clock);
      const unused = {
        execute: async () => {
          throw new Error('unused use case');
        },
      } as unknown as CommissionInputUseCases['lines'] & CommissionInputUseCases['salary'] &
        CommissionInputUseCases['sales'];
      await onCommissionInputEvent(
        {
          lines: unused,
          tips: new ProjectSessionTips(
            createCommissionTipProjectionScope(tx, businessTimeZone, ids),
            clock,
            ids,
            {
              ...corrections,
              insertCorrections: async () => {
                throw new Error('injected correction insert failure');
              },
            },
            noCommissionBlockNotices,
          ),
          salary: unused,
          sales: unused,
        },
        event,
      );
    },
  };
}

/** مستهلك تفشل كتابة تصحيحات الراتب فيه بعد إعادة الحساب؛ CM-22 لمسار الراتب. */
export function failingSalaryCorrectionsConsumer(): OutboxConsumer {
  const clock = { now: () => new Date(CURRENT) };
  const standard = consumerWithClock(clock);
  return {
    id: standard.id,
    eventTypes: standard.eventTypes,
    handle: async (tx, event) => {
      const corrections = createCommissionCorrectionScope(tx, ids, clock);
      const unused = {
        execute: async () => {
          throw new Error('unused use case');
        },
      } as unknown as CommissionInputUseCases['lines'] & CommissionInputUseCases['tips'] &
        CommissionInputUseCases['sales'];
      await onCommissionInputEvent(
        {
          lines: unused,
          tips: unused,
          sales: unused,
          salary: new ProjectSalary(
            createCommissionSalaryProjectionScope(
              tx,
              businessCalendarReader,
              employeeBusinessReader,
            ),
            clock,
            ids,
            {
              ...corrections,
              insertCorrections: async () => {
                throw new Error('injected correction insert failure');
              },
            },
            noCommissionBlockNotices,
          ),
        },
        event,
      );
    },
  };
}
