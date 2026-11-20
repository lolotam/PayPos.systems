import {
  createDatabase,
  lockStatementPeriods,
  reopenReviewedStatementPeriods,
  type ClaimedEvent,
  type Database,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import {
  insertCommissionAttachment,
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import {
  onCommissionInputEvent,
  type CommissionInputUseCases,
} from '../events/handlers/on-commission-input-event.handler.ts';
import { createCommissionCorrectionScope } from '../persistence/commission-correction.scope.ts';
import { createCommissionLineProjectionScope } from '../persistence/commission-line-projection.scope.ts';
import { ProjectServiceLines } from '../use-cases/project-service-lines/project-service-lines.ts';

export const A = COMMISSION_LINE_TENANTS.A;
export const B = COMMISSION_LINE_TENANTS.B;
export const ids = systemUuidV7();
export const CURRENT = '2026-12-05T09:00:00Z';
export const FOLLOW_PLAN = { kind: 'FOLLOW_PLAN' } as const;
const businessTimeZone = fakeBusinessTimeZone(A.business);
// خطة المثال المحسوب (O3): شرائح بشرط مضاعف راتب 1.00 يدفع 10% فوق الحد، بلا أساسي.
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

let testDb: TestDatabase;
export let owner: postgres.Sql;
export let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_blocked_corrections`;
  await owner`DELETE FROM commission_corrections`;
  await owner`DELETE FROM commission_period_generations`;
  await owner`DELETE FROM commission_statement_attachments`;
  await owner`DELETE FROM commission_statement_lines`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM commission_service_overrides`;
  await owner`DELETE FROM commission_plan_versions`;
  await owner`DELETE FROM commission_salaries`;
  await owner`DELETE FROM commission_tips`;
  await owner`DELETE FROM commission_tip_heads`;
  await owner`DELETE FROM commission_lines`;
  await owner`DELETE FROM commission_line_heads`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  await owner`UPDATE businesses SET created_at = '2025-01-01T00:00:00Z' WHERE company_id = ${A.company} AND id = ${A.business}`;
});

export const deliver = async (now: string, event: ClaimedEvent) => {
  const consumer = createTestCommissionInputsConsumer({
    ids,
    clock: { now: () => new Date(now) },
    businessTimeZone,
  });
  return createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  })(event);
};

export async function seedLineSession(
  period: string,
  day: number,
  net: string,
  lineId: string = COMMISSION_LINE_IDS.lineA,
): Promise<void> {
  const day2 = String(day).padStart(2, '0');
  const recorded = commissionLineEvent(A, ids, 'ServiceSessionRecorded', {
    lineId,
    businessDate: `${period}-${day2}`,
    occurredAt: `${period}-${day2}T09:00:00.000Z`,
    net,
    ruleSnapshot: FOLLOW_PLAN,
  });
  const result = await deliver(CURRENT, recorded);
  if (!result.delivered) throw new Error('the source projection did not deliver');
}

export async function approveClosed(
  period: string,
  lines: Parameters<typeof insertCommissionLine>[4][] = [],
): Promise<string> {
  return walkCommissionStatement(db, {
    tenant: A,
    period,
    ids,
    to: 'APPROVED',
    afterApproved: async (tx, statementId) => {
      for (const line of lines) {
        await insertCommissionLine(tx, A, statementId, ids, {
          employeeId: A.employee,
          sourceBranchId: A.branch,
          attachedBranchIds: [A.branch],
          ...line,
        });
      }
      await insertCommissionAttachment(tx, A, statementId, ids, { employeeId: A.employee });
    },
  });
}

export async function seedPlan(effectiveFrom: string, plan: unknown): Promise<void> {
  await db.withTenant(A.company, (tx) =>
    insertCommissionPlanVersion(tx, A, ids, { employeeId: A.employee, effectiveFrom, plan }),
  );
}

export const lineChanged = (row: Record<string, unknown>): ClaimedEvent =>
  commissionLineEvent(A, ids, 'ServiceLineChanged', {
    revision: 2,
    changeKind: 'PRICE_DISCOUNT_EDIT',
    ruleSnapshot: FOLLOW_PLAN,
    ...row,
  });

export const linesAdded = (
  lines: readonly Record<string, unknown>[],
  sessionId: string,
): ClaimedEvent =>
  commissionLineEvent(A, ids, 'ServiceSessionLinesAdded', {
    sessionId,
    lines,
  });

/** يرجع October إلى DRAFT عبر طبقة التخزين نفسها بترتيب القفل والفتح الحقيقي. */
export async function reopenDraft(period: string): Promise<void> {
  await db.withTenant(A.company, async (tx) => {
    await lockStatementPeriods(tx, { businessId: A.business, periods: [period], ids });
    await reopenReviewedStatementPeriods(tx, { businessId: A.business, periods: [period] });
  });
}

export const blocks =
  () => owner`SELECT id::text AS id, employee_id,source_period,code,first_event_id,
  target_period,target_statement_id,resolved_at,resolved_generation
  FROM commission_blocked_corrections
  ORDER BY employee_id,source_period,resolved_at NULLS FIRST,created_at,id`;
export const corrections = () => owner`SELECT employee_id,source_period,target_period,
  target_statement_id,source_ref,kind,amount,previous_amount,new_amount,generation,event_id
  FROM commission_corrections ORDER BY employee_id,generation,source_ref`;
export const generations = () => owner`SELECT employee_id,period,generation
  FROM commission_period_generations ORDER BY employee_id,period`;
export const marks = () => owner`SELECT event_id FROM consumed_events
  WHERE consumer_id='commissions.project-inputs' ORDER BY event_id`;
export const heads = () => owner`SELECT line_id::text AS line_id,revision,status,period
  FROM commission_line_heads ORDER BY line_id`;
export const salaryRows = () => owner`SELECT employee_id,effective_from::text AS effective_from,
  amount,revision FROM commission_salaries ORDER BY employee_id,effective_from`;
export const tipHeads = () => owner`SELECT session_id::text AS session_id,revision,period
  FROM commission_tip_heads ORDER BY session_id`;

export const statementIdByPeriod = async (period: string): Promise<string> => {
  const rows = await owner`SELECT id::text AS id FROM commission_statements
    WHERE company_id=${A.company} AND business_id=${A.business} AND period=${period}`;
  if (rows[0] === undefined) throw new Error(`no statement row for ${period}`);
  return rows[0].id;
};

export interface SeptemberBlockSeed {
  readonly lateEvent: ClaimedEvent;
  readonly secondLateEvent: ClaimedEvent;
}

/** يبني سيناريو K1: سبتمبر معتمد بخطة من 15 فقط، وبندان متأخران قبل الخطة بلا تسجيل بعد. */
export async function seedSeptemberPlanGap(lineNet = '200.000'): Promise<SeptemberBlockSeed> {
  await seedLineSession('2026-09', 15, lineNet);
  await seedPlan('2026-09-15', {
    base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
    tiers: { enabled: false },
    package_sale: { enabled: false },
  });
  await approveClosed('2026-09', [
    {
      kind: 'COMMISSION',
      lineId: COMMISSION_LINE_IDS.lineA,
      sourceRef: `line:${COMMISSION_LINE_IDS.lineA}`,
      amount: '10.000',
      sourceBusinessDate: '2026-09-15',
    },
  ]);
  const lateEvent = linesAdded(
    [
      {
        lineId: COMMISSION_LINE_IDS.lineB,
        businessDate: '2026-09-10',
        occurredAt: '2026-09-10T09:00:00.000Z',
        net: lineNet,
        previousNet: lineNet,
        revision: 1,
        ruleSnapshot: FOLLOW_PLAN,
      },
    ],
    COMMISSION_LINE_IDS.sessionA,
  );
  const secondLateEvent = linesAdded(
    [
      {
        lineId: ids.newId(),
        businessDate: '2026-09-05',
        occurredAt: '2026-09-05T09:00:00.000Z',
        net: '100.000',
        revision: 1,
        ruleSnapshot: FOLLOW_PLAN,
      },
    ],
    COMMISSION_LINE_IDS.sessionA,
  );
  return { lateEvent, secondLateEvent };
}

/** يبني سيناريو NO_SALARY: سبتمبر معتمد بلا صف مجمّد لها، وبند L1 قبل أي مرتب. */
export async function seedSeptemberNoSalary(
  planEffectiveFrom: string,
): Promise<{ lineEvent: ClaimedEvent; lineRef: string }> {
  await seedLineSession('2026-09', 20, '700.000');
  await seedPlan(planEffectiveFrom, SALARY_THRESHOLD_PLAN);
  await approveClosed('2026-09');
  const lineRef = `line:${COMMISSION_LINE_IDS.lineA}`;
  const lineEvent = lineChanged({
    lineId: COMMISSION_LINE_IDS.lineA,
    businessDate: '2026-09-20',
    occurredAt: '2026-09-20T09:00:00.000Z',
    net: '700.000',
    previousNet: '700.000',
  });
  return { lineEvent, lineRef };
}

/** مستهلك يفشل كتابة التوقف نفسها بعد إعادة الحساب؛ CM-22 لخطوة التوقف. */
function failingInsertBlockConsumer(): OutboxConsumer {
  const clock = { now: () => new Date(CURRENT) };
  const standard = createTestCommissionInputsConsumer({ ids, clock, businessTimeZone });
  return {
    id: standard.id,
    eventTypes: standard.eventTypes,
    handle: async (tx, event) => {
      const corrections = createCommissionCorrectionScope(tx, ids, clock);
      const unused = {
        execute: async () => {
          throw new Error('unused line-only use case');
        },
      } as unknown as CommissionInputUseCases['tips'] & CommissionInputUseCases['salary'];
      await onCommissionInputEvent(
        {
          lines: new ProjectServiceLines(
            createCommissionLineProjectionScope(tx, businessTimeZone),
            clock,
            ids,
            {
              ...corrections,
              insertBlock: async () => {
                throw new Error('injected block insert failure');
              },
            },
          ),
          tips: unused,
          salary: unused,
        },
        event,
      );
    },
  };
}

export const deliverFailing = (event: ClaimedEvent) => {
  const consumer = failingInsertBlockConsumer();
  return createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  })(event);
};
