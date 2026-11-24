import { createDatabase, type ClaimedEvent, type Database, type Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pendingCountHarness } from '../../../../packages/db/test/statement-pending-fixtures.ts';
import {
  commissionSalaryEvent,
  commissionTipEvent,
} from '../../../worker/src/modules/commissions/__tests__/commission-tip-salary-events.ts';
import { createCommissionInputsConsumer } from '../../../worker/src/modules/commissions/index.ts';
import { businessPermissionHolders } from '../../../worker/src/modules/identity/index.ts';
import { createDeliverer } from '../../../worker/src/outbox/deliver.ts';
import {
  approvalFootprint,
  approve,
  approverMember,
  issueProof,
  openSwitch,
  resetCoverage,
  resetStatementToDraft,
  reviewedStatement,
  type Approver,
} from '../modules/commissions/__tests__/approve-statement.fixture.ts';
import {
  statementFixture,
  type StatementFixture,
} from '../modules/commissions/__tests__/commission-statement.fixture.ts';

/*
 * ترتيب الاعتماد (§7) في approve-statement.usecase.ts، السطران بالترتيب:
 *   assertFingerprintsCurrent(command, source.statement, computed);   (الخطوة 6)
 *   if ((await scope.countPendingEvents(cutoff)) > 0) refuse('COMMISSION_UPDATES_PENDING');   (الخطوة 7)
 * يعني: البصمة القديمة بتترفض قبل عدّاد الأحداث المعلّقة. فالحدث غير المستهلك بيخلي الاعتماد يرفض بـ
 * 409 COMMISSION_UPDATES_PENDING طالما المصدر ما اتغيّرش؛ وبعد ما المستهلك يكتب إسقاطه بيعيد الشهر إلى DRAFT،
 * فالاعتماد القديم يرفض بـ 409 COMMISSION_STATEMENT_NOT_REVIEWED لحد ما المراجع يعيد المراجعة — وبعدها يعتمد،
 * والحدث لازم يكون وصل للصفوف المجمّدة مرة واحدة بالعلامة نفسها.
 * الملف هنا (مش جوّه موديول commissions) لأن اختبار بيستهلك موديول الـworker، وحدّ الموديول بيمر على الاستيراد
 * المتقاطع (نفس سبب commission-line-producer-delivery.spec.ts).
 */
const TEST_TIMEOUT_MS = 180_000;
const ids = systemUuidV7();
const CLOCK = { now: () => new Date('2026-12-02T09:00:00Z') };

let f: StatementFixture;
let approver: Approver;
let worker: Database;

beforeAll(async () => {
  f = await statementFixture();
  approver = await approverMember(f, 'worker-race-approver');
  worker = createDatabase({ url: f.h.urls.app, ids });
});

afterAll(async () => {
  await worker?.close();
  await f?.h.close();
});

const harness = () =>
  pendingCountHarness(
    () => f.h.owner,
    () => f.h.owner,
  );

/** قارئ المنطقة الزمنية للنشاط: نفس جدول tenancy في الـworker. */
const readBusinessTimeZone = async (
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<string | null> => {
  const rows = await tx.execute<{ timezone: string }>(
    sql`SELECT timezone FROM businesses WHERE company_id=${companyId} AND id=${businessId}`,
  );
  return rows[0]?.timezone ?? null;
};

/** قارئ تقويم النشاط: نفس جدول tenancy في الـworker. */
const readBusinessCalendar = async (
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<{ timeZone: string; createdAt: Date } | null> => {
  const rows = await tx.execute<{ timezone: string; created_at: string }>(
    sql`SELECT timezone, created_at FROM businesses WHERE company_id=${companyId} AND id=${businessId}`,
  );
  const row = rows[0];
  return row === undefined
    ? null
    : { timeZone: row.timezone, createdAt: new Date(row.created_at) };
};

/** قارئ نشاط الموظفة: نفس جدول staff في الـworker. */
const readEmployeeBusiness = async (
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<string | null> => {
  const rows = await tx.execute<{ business_id: string }>(
    sql`SELECT business_id FROM employees WHERE company_id=${companyId} AND id=${employeeId}`,
  );
  return rows[0]?.business_id ?? null;
};

interface Delivery {
  /** يتحل لما المستهلك يكتب علامة الاستهلاك (قبل أي إسقاط). */
  readonly marked: Promise<void>;
  /** يفرج عن المستهلك فيكمل الإسقاط. */
  resume(): void;
  /** نتيجة التسليم. */
  readonly delivered: Promise<unknown>;
}

/**
 * يشغّل المستهلك الحقيقي (commissions.project-inputs) فوق التسليم الحقيقي، ويوقف المعاملة بعد ما علامة
 * الاستهلاك تتكتب وقبل ما الإسقاط يكتب. فالعلامة غير ملتزمة، فالحدث يفضل "غير مستهلك" من عين العدّاد.
 *
 * @param event الحدث المحسوب
 * @returns التسليم الموقوف
 */
function deliverPausedAfterMark(event: ClaimedEvent): Delivery {
  let marked: () => void = () => undefined;
  let release: () => void = () => undefined;
  const markedReady = new Promise<void>((resolve) => {
    marked = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dialect = new PgDialect();
  const consumer = createCommissionInputsConsumer({
    ids,
    clock: CLOCK,
    businessTimeZone: readBusinessTimeZone,
    businessCalendar: readBusinessCalendar,
    employeeBusiness: readEmployeeBusiness,
    permissionHolders: businessPermissionHolders,
  });
  const pausing: Pick<Database, 'withTenant'> = {
    withTenant: (company, work, options) =>
      worker.withTenant(
        company,
        async (tx) => {
          const proxy = new Proxy(tx, {
            get(target, prop) {
              const value: unknown = Reflect.get(target, prop, target);
              if (prop !== 'execute') {
                return typeof value === 'function' ? value.bind(target) : value;
              }
              return async (query: SQL) => {
                const result = await (value as (q: SQL) => Promise<unknown>).call(target, query);
                if (dialect.sqlToQuery(query).sql.includes('INSERT INTO consumed_events')) {
                  marked();
                  await resumed;
                }
                return result;
              };
            },
          }) as Tx;
          return work(proxy);
        },
        options,
      ),
  };
  const deliver = createDeliverer(pausing, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  return { marked: markedReady, resume: release, delivered: deliver(event) };
}

interface Race {
  /** رد الاعتماد والحدث لسه غير مستهلك. */
  readonly pending: { status: number; code: string | undefined };
  /** رد الاعتماد بعد ما المستهلك أعاد الشهر إلى DRAFT. */
  readonly reopened: { status: number; code: string | undefined };
  /** رد الاعتماد بعد إعادة المراجعة. */
  readonly approved: { status: number };
  /** البصمة اللي اتجمّدت مع الكشف. */
  readonly frozenFingerprint: string | null;
  /** عدد علامات الاستهلاك للحدث ده. */
  readonly marks: number;
  /** عدد الصفوف المجمّدة. */
  readonly lines: number;
  /** عدد المراجع المختلفة في الصفوف المجمّدة (الصف نفسه ما يتكررش). */
  readonly distinct: number;
}

/**
 * يسبّق الاعتماد بالمستهلك: الطلب شغّال جوه معاملة الاستهلاك (العلامة مكتوبة وغير ملتزمة)، فالاعتماد بيقرأ
 * الحدث كأنه لسه معلّق فيرفض؛ وبعد ما المستهلك يلتزم يعيد الشهر إلى DRAFT فيرفض الاعتماد القديم لأنه مش مراجع؛
 * وبعد إعادة المراجعة يعتمد والصفوف المجمّدة بتطلع مرة واحدة.
 *
 * @param event الحدث المحسوب نوعه من الستة المحسوبة
 * @returns نتائج السباق
 */
async function raceTheWorker(event: ClaimedEvent): Promise<Race> {
  await resetStatementToDraft(f);
  await resetCoverage(f);
  const first = await reviewedStatement(f, approver);
  await openSwitch(f, approver.userId);
  await issueProof(f);
  const { seedEvent } = harness();
  // الحدث بيتسجّل في الـoutbox بتاريخ قبل أي اعتماد (العدّاد بiscountّ الحدث اللي قبل بداية الاعتماد بس).
  await seedEvent(f.company, event.id, event.eventType);

  const delivery = deliverPausedAfterMark(event);
  const pending: { status: number; code: string | undefined } = { status: 0, code: undefined };
  try {
    await delivery.marked;
    // العلامة مكتوبة في المعاملة بس مش ملتزمة، فالحدث يفضل معلّقًا من عين العدّاد.
    const marks = await f.h.owner`SELECT count(*)::int AS total FROM consumed_events
      WHERE company_id = ${f.company} AND event_id = ${event.id}`;
    expect(marks[0]?.['total']).toBe(0);

    const refused = await approve(f, approver.cookie, `worker-race-pending-${event.id}`, first);
    pending.status = refused.status;
    pending.code = (refused.body as { code?: string }).code;
    expect(await approvalFootprint(f)).toMatchObject({ status: 'REVIEWED', lines: 0 });
  } finally {
    delivery.resume();
  }
  await delivery.delivered;

  const reopened = await approve(f, approver.cookie, `worker-race-reopened-${event.id}`, first);
  const reopenedOutcome = {
    status: reopened.status,
    code: (reopened.body as { code?: string }).code,
  };
  await resetStatementToDraft(f);
  const second = await reviewedStatement(f, approver);
  const approved = await approve(f, approver.cookie, `worker-race-approved-${event.id}`, second);
  const footprint = await approvalFootprint(f);
  const [statement] = await f.h.owner`SELECT input_fingerprint FROM commission_statements
    WHERE company_id = ${f.company} AND business_id = ${f.business} AND period = '2026-11'`;
  const marks = await f.h.owner`SELECT count(*)::int AS total FROM consumed_events
    WHERE company_id = ${f.company} AND event_id = ${event.id}`;
  const [distinct] = await f.h.owner`SELECT count(DISTINCT (employee_id, source_ref))::int AS total
    FROM commission_statement_lines`;

  return {
    pending,
    reopened: reopenedOutcome,
    approved: { status: approved.status },
    frozenFingerprint: (statement?.['input_fingerprint'] as string) ?? null,
    marks: marks[0]?.['total'] as number,
    lines: footprint.lines,
    distinct: distinct?.['total'] as number,
  };
}

describe('the approval racing the worker consumer (CM-36)', () => {
  it('refuses with 409 COMMISSION_UPDATES_PENDING while the salary event is unconsumed, and freezes it once', async () => {
    const event = commissionSalaryEvent(f.tenant, ids, {
      effectiveFrom: '2026-11-01',
      amount: '500.000',
      revision: 1,
    });
    const race = await raceTheWorker(event);

    expect(race.pending).toEqual({ status: 409, code: 'COMMISSION_UPDATES_PENDING' });
    expect(race.reopened).toEqual({ status: 409, code: 'COMMISSION_STATEMENT_NOT_REVIEWED' });
    expect(race.approved.status).toBe(200);
    expect(race.frozenFingerprint).not.toBeNull();
    expect(race.marks).toBe(1);
    expect(race.lines).toBeGreaterThan(0);
    // «مش مرتين»: كل صف مجمّد له مرجع واحد، والعلامة واحدة.
    expect(race.distinct).toBe(race.lines);
  }, TEST_TIMEOUT_MS);

  it('refuses with 409 COMMISSION_UPDATES_PENDING while the tip event is unconsumed, and freezes it once', async () => {
    const event = commissionTipEvent(f.tenant, ids, {
      businessDate: '2026-11-01',
      tips: [{ employee_id: f.employee, method: 'CARD', amount: '10.000' }],
    });
    const race = await raceTheWorker(event);

    expect(race.pending).toEqual({ status: 409, code: 'COMMISSION_UPDATES_PENDING' });
    expect(race.reopened).toEqual({ status: 409, code: 'COMMISSION_STATEMENT_NOT_REVIEWED' });
    expect(race.approved.status).toBe(200);
    expect(race.frozenFingerprint).not.toBeNull();
    expect(race.marks).toBe(1);
    expect(race.lines).toBeGreaterThan(0);
    expect(race.distinct).toBe(race.lines);
  }, TEST_TIMEOUT_MS);

  it.todo('CM-36: a session event (ServiceSessionRecorded) racing the approval');
  it.todo('CM-36: a redemption event racing the approval');
  it.todo('CM-36: a refund event racing the approval');
  it.todo('CM-36: a plan version change racing the approval');
  it.todo('CM-36: a service override change racing the approval');
});
