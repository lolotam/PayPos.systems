import { lockStatementPeriods, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { COMMISSION_LINE_IDS } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import {
  FINGERPRINTS,
  insertCommissionAttachment,
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  A,
  changed,
  corrections,
  CURRENT,
  db,
  deliverAt,
  FOLLOW_PLAN,
  generations,
  ids,
  lineEvent,
  marks,
  owner,
  SOURCE_PERIOD,
  statementStatus,
  TARGET_PERIOD,
} from './project-service-lines-corrections-db.fixture.ts';

/** جلسة الخط B: جلسة مستقلة عن جلسة الخط A عشان كل بند يتقاس في سياقه. */
const SESSION_B = '01920000-0000-7000-8000-00000000d402';
/** الخط C: بند شغل في أكتوبر اتسجل في ديسمبر، فبيقيس شهر أكتوبر بعد اعتماده. */
const LINE_C = '01920000-0000-7000-8000-00000000d503';
const SESSION_C = '01920000-0000-7000-8000-00000000d403';
const LINE_A = COMMISSION_LINE_IDS.lineA;
const LINE_B = COMMISSION_LINE_IDS.lineB;
const SESSION_A = COMMISSION_LINE_IDS.sessionA;
const REF_A = `line:${LINE_A}`;
const REF_B = `line:${LINE_B}`;
const REF_C = `line:${LINE_C}`;
const SEPTEMBER = '2026-09';
const OCTOBER = '2026-10';

/** خطة الشرائح الهامشية: 5% على ما يتجاوز 500.000 من صافي الشهر. */
const TIER_PLAN = {
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'AMOUNT', value: '500.000' }, calc: { kind: 'PCT', bps: 500 } }],
  },
  package_sale: { enabled: false },
} as const;

/** خطة الأساس: 5% على صافي كل بند. */
const FLAT_PLAN = {
  base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
  tiers: { enabled: false },
  package_sale: { enabled: false },
} as const;

/** بنود أكتوبر وصفوف كشفها المجمّد: الخط A فوق حد الشريحة والخط B تحته. */
const OCTOBER_LINES = [
  { lineId: LINE_A, sessionId: SESSION_A, day: '10', net: '600.000', ref: REF_A, amount: '5.000' },
  { lineId: LINE_B, sessionId: SESSION_B, day: '20', net: '400.000', ref: REF_B, amount: '20.000' },
];

/** صف كشف مجمّد واحد: بند خدمة بفرعه ومبلغه. */
type FrozenLine = { lineId: string; sessionId: string; ref: string; amount: string };

/** يبني صف التصحيح بالصيغة اللي جدول التصحيحات بيرجّعها. */
function correction(row: {
  readonly ref: string;
  readonly amount: string;
  readonly previous: string;
  readonly next: string;
  readonly generation: number;
}) {
  return {
    employee_id: A.employee,
    source_period: SOURCE_PERIOD,
    target_period: TARGET_PERIOD,
    source_ref: row.ref,
    kind: 'COMMISSION',
    amount: row.amount,
    previous_amount: row.previous,
    new_amount: row.next,
    generation: row.generation,
  };
}

/** يزرع راتب الموظفة وخطة ساريتها؛ الشرائح بلا راتب ما بتتسعّرش. */
async function seedPlan(plan: unknown, effectiveFrom: string): Promise<void> {
  await owner`INSERT INTO commission_salaries(
    company_id,id,business_id,employee_id,effective_from,amount,revision)
    VALUES(${A.company},${ids.newId()},${A.business},${A.employee},'2026-01-01'::date,'500.000',1)`;
  await db.withTenant(A.company, async (tx) => {
    await insertCommissionPlanVersion(tx, A, ids, {
      employeeId: A.employee,
      effectiveFrom,
      plan,
    });
  });
}

/** يكتب صف كشف مجمّد لبند خدمة؛ الصف بيتجمّد في معاملة الاعتماد نفسها. */
async function insertFrozenLine(
  tx: Tx,
  statementId: string,
  line: FrozenLine,
  date: string,
): Promise<void> {
  await insertCommissionLine(tx, A, statementId, ids, {
    kind: 'COMMISSION',
    lineId: line.lineId,
    sessionId: line.sessionId,
    serviceId: A.service,
    customerId: A.customer,
    sourceRef: line.ref,
    amount: line.amount,
    sourceBranchId: A.branch,
    sourceBusinessDate: date,
    businessDate: date,
    attachedBranchIds: [A.branch],
  });
}

/** يسجّل خطي أكتوبر بالخطة الهمجية: الخط A فوق حد الشريحة والخط B تحته. */
async function seedOctoberTierMonth(): Promise<void> {
  await seedPlan(TIER_PLAN, '2026-10-01');
  for (const line of OCTOBER_LINES) {
    const at = `2026-10-${line.day}T09:00:00Z`;
    const event = lineEvent('ServiceSessionRecorded', {
      lineId: line.lineId,
      sessionId: line.sessionId,
      occurredAt: at,
      recordedAt: at,
      businessDate: `2026-10-${line.day}`,
      net: line.net,
      ruleSnapshot: FOLLOW_PLAN,
    });
    expect(await deliverAt(CURRENT, event)).toEqual({ delivered: true });
  }
  await walkCommissionStatement(db, {
    tenant: A,
    period: SOURCE_PERIOD,
    ids,
    to: 'APPROVED',
    afterApproved: async (tx, statementId) => {
      for (const line of OCTOBER_LINES) {
        await insertFrozenLine(tx, statementId, line, `2026-10-${line.day}`);
      }
      await insertCommissionAttachment(tx, A, statementId, ids, { employeeId: A.employee });
    },
  });
}

/** يسجّل خط سبتمبر ويبقيه مراجَعاً: 200.000 بخطة أساس 5% وراتب 500.000. */
async function seedSeptemberFlatMonth(): Promise<void> {
  await seedPlan(FLAT_PLAN, '2026-09-01');
  const recorded = lineEvent('ServiceSessionRecorded', {
    lineId: LINE_A,
    sessionId: SESSION_A,
    occurredAt: '2026-09-15T09:00:00Z',
    recordedAt: '2026-09-15T09:00:00Z',
    businessDate: '2026-09-15',
    net: '200.000',
    ruleSnapshot: FOLLOW_PLAN,
  });
  expect(await deliverAt(CURRENT, recorded)).toEqual({ delivered: true });
  await walkCommissionStatement(db, { tenant: A, period: SEPTEMBER, ids, to: 'REVIEWED' });
}

/** تصحيحات الجيل الأول: إلغاء الخط A يسقط حد الشريحة فيسقط الخط B تحته. */
const GENERATION_ONE = [
  correction({ ref: REF_A, amount: '-5.000', previous: '5.000', next: '0.000', generation: 1 }),
  correction({ ref: REF_B, amount: '-20.000', previous: '20.000', next: '0.000', generation: 1 }),
];

/** تصحيحات الجيل الثاني: الخط C بسحب الخط B فوق حد الشريحة تاني. */
const GENERATION_TWO = [
  correction({ ref: REF_B, amount: '20.000', previous: '0.000', next: '20.000', generation: 2 }),
  correction({ ref: REF_C, amount: '5.000', previous: '0.000', next: '5.000', generation: 2 }),
];

/**
 * ينتظر حتى يظهر منتظر على قفل صف كشف؛ الحصر بقاعدة الاختبار بيجي من pg_stat_activity مش من
 * pg_locks.database: أقفال transactionid بتتسجل بـ database NULL، ففلتر الداتابيز كان هيصفّيها كلها.
 * واستبعاد دور المراقبة (owner) بيمنع أي عميل غريب إنه يفتح العائق قبل وصول المستهلك الحقيقي.
 */
async function waitForStatementLockWaiter(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await owner<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted AND l.locktype IN ('transactionid', 'tuple')
        AND a.datname = current_database()
        AND a.usename <> current_user`;
    if ((row?.waiting ?? 0) >= 1) return;
    await new Promise((resolve) => {
      setTimeout(() => resolve(undefined), 25);
    });
  }
  throw new Error('the consumer never waited on the held statement lock');
}

interface SeedBarrier {
  readonly seed: Promise<void>;
  readonly releaseSeed: () => void;
  readonly seedHeld: Promise<void>;
}

/** معاملة اعتماد معيقة: تحجز شهر سبتمبر ثم توافق وتجمّد الخط A عند فك العائق. */
function startApprovalBehindBarrier(): SeedBarrier {
  let releaseSeed: () => void = () => undefined;
  const seedBarrier = new Promise<void>((resolve) => {
    releaseSeed = resolve;
  });
  let signalSeedLocked: () => void = () => undefined;
  const seedHeld = new Promise<void>((resolve) => {
    signalSeedLocked = resolve;
  });
  const seed = db.withTenant(A.company, async (tx) => {
    const [statement] = await lockStatementPeriods(tx, {
      businessId: A.business,
      periods: [SEPTEMBER],
      ids,
    });
    signalSeedLocked();
    await seedBarrier;
    await tx.execute(sql`UPDATE commission_statements
      SET status='APPROVED', approved_by=${USER}, approved_at='2026-11-02T08:00:00Z',
        input_fingerprint=${FINGERPRINTS.input}, statement_fingerprint=${FINGERPRINTS.statement}
      WHERE company_id=${A.company} AND id=${statement?.statementId}::uuid`);
    await insertFrozenLine(
      tx,
      statement?.statementId ?? '',
      { lineId: LINE_A, sessionId: SESSION_A, ref: REF_A, amount: '10.000' },
      '2026-09-15',
    );
    await insertCommissionAttachment(tx, A, statement?.statementId ?? '', ids, {
      employeeId: A.employee,
    });
  });
  return { seed, releaseSeed, seedHeld };
}

it('CM-43 a cancelled tier line drops the next line below the tier and a late line re-prices the month', async () => {
  await seedOctoberTierMonth();

  const cancelled = changed({
    lineId: LINE_A,
    sessionId: SESSION_A,
    revision: 2,
    net: '600.000',
    previousNet: '600.000',
    businessDate: '2026-10-10',
    occurredAt: '2026-10-10T09:00:00Z',
    changeKind: 'LINE_CANCELLED',
    status: 'CANCELLED',
  });
  expect(await deliverAt(CURRENT, cancelled)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject(GENERATION_ONE);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: SOURCE_PERIOD, generation: 1 },
  ]);

  const late = lineEvent('ServiceSessionRecorded', {
    lineId: LINE_C,
    sessionId: SESSION_C,
    occurredAt: '2026-10-12T09:00:00Z',
    recordedAt: '2026-12-05T08:00:00Z',
    businessDate: '2026-10-12',
    net: '600.000',
    ruleSnapshot: FOLLOW_PLAN,
  });
  expect(await deliverAt(CURRENT, late)).toEqual({ delivered: true });

  expect(await corrections()).toMatchObject([...GENERATION_ONE, ...GENERATION_TWO]);
  expect(await generations()).toEqual([
    { employee_id: A.employee, period: SOURCE_PERIOD, generation: 2 },
  ]);
  expect(await marks()).toHaveLength(4);
});

it('CM-48c the line consumer waits for the in-flight approval and posts into October', async () => {
  await seedSeptemberFlatMonth();
  const { seed, releaseSeed, seedHeld } = startApprovalBehindBarrier();
  await seedHeld;

  const event = changed({
    businessDate: '2026-09-15',
    occurredAt: '2026-09-15T09:00:00Z',
    revision: 2,
    changeKind: 'LINE_CANCELLED',
    status: 'CANCELLED',
  });
  const delivery = deliverAt(CURRENT, event);
  // لو الانتظار فشل لازم العائق يتحرر برضه، وإلا معاملة الاعتماد تفضل متجمدة ماسكة اتصال وأقفال
  // الكشف، والفشل الحقيقي يغرق في ضجيج teardown. الوعدَين بيتسوّوا بـ allSettled قبل الرمي.
  let waiterError: unknown;
  try {
    await waitForStatementLockWaiter();
  } catch (error) {
    waiterError = error;
  } finally {
    releaseSeed();
  }
  const [seedOutcome, deliveryOutcome] = await Promise.allSettled([seed, delivery]);
  if (waiterError !== undefined) throw waiterError;
  if (seedOutcome.status === 'rejected') throw seedOutcome.reason;
  if (deliveryOutcome.status === 'rejected') throw deliveryOutcome.reason;

  expect(deliveryOutcome.value).toEqual({ delivered: true });
  expect(await statementStatus(SEPTEMBER)).toMatchObject([
    { period: SEPTEMBER, status: 'APPROVED' },
  ]);
  expect(await corrections()).toMatchObject([
    {
      employee_id: A.employee,
      source_period: SEPTEMBER,
      target_period: OCTOBER,
      source_ref: REF_A,
      kind: 'COMMISSION',
      amount: '-10.000',
      previous_amount: '10.000',
      new_amount: '0.000',
      generation: 1,
    },
  ]);
  expect(await marks()).toHaveLength(2);
}, 30_000);
