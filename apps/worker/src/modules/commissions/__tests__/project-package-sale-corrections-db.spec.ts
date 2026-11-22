import {
  commissionCorrectionBlockedNoticeGroupSize,
  commissionCorrectionBlockedNoticeRequested,
} from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import { insertCommissionSale } from '../../../../../../packages/db/test/commission-sales-fixtures.ts';
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
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import { commissionSaleEvent } from './commission-tip-salary-events.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import { recordCommissionFailureCodes } from '../index.ts';
import { createCommissionSaleProjectionScope } from '../persistence/commission-sale-projection.scope.ts';
import { createCommissionCorrectionScope } from '../persistence/commission-correction.scope.ts';
import { createCommissionBlockNotices } from '../persistence/commission-block-notice.outbox.ts';
import { onCommissionInputEvent } from '../events/handlers/on-commission-input-event.handler.ts';
import type { CommissionInputUseCases } from '../events/handlers/on-commission-input-event.handler.ts';
import { ProjectPackageSale } from '../use-cases/project-package-sale/project-package-sale.ts';

/** قارئ حاملي الصلاحية ما بيتنادىش في اختبارات البيع؛ بيحتاج identity وده ممنوع جوه الموديول. */
const noPermissionHolders = async (): Promise<readonly string[]> => [];

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let consumer: OutboxConsumer;
let deliver: ReturnType<typeof createDeliverer>;
const failures = new Map<string, string>();
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const clock = { now: () => new Date('2026-11-20T09:00:00Z') };

const SALE_ID = '01970000-0000-7000-8000-000000000301';
const SOURCE_PERIOD = '2026-10';
const TARGET_PERIOD = '2026-11';
const SALE_DATE = '2026-10-15';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  consumer = createTestCommissionInputsConsumer({
    ids,
    clock,
    businessTimeZone: fakeBusinessTimeZone(A.business),
  });
  deliver = createDeliverer(db, [recordCommissionFailureCodes(consumer, failures)], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  failures.clear();
  await owner`DELETE FROM commission_blocked_corrections`;
  await owner`DELETE FROM commission_corrections`;
  await owner`DELETE FROM commission_period_generations`;
  await owner`DELETE FROM commission_statement_attachments`;
  await owner`DELETE FROM commission_statement_lines`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM commission_sales`;
  await owner`DELETE FROM commission_plan_versions`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  await seedSaleProjection();
  await seedFrozenStatement();
});

/**
 * يزرع صف البيع المحفوظ بحالة 'SOLD' ونسخة خطة تسعّر بيع الباقة بنسبة عشرة بالمئة،
 * فالمبلغ المتوقع لبيع بثلاثين دينار هو ثلاثة دنانير قبل المرتجع.
 */
async function seedSaleProjection(): Promise<void> {
  await db.withTenant(A.company, async (tx) => {
    await insertCommissionSale(tx, A, {
      sale: SALE_ID,
      businessDate: SALE_DATE,
      period: SOURCE_PERIOD,
      pricePaid: '30.000',
      refundedAmount: '0.000',
      status: 'SOLD',
      revision: 1,
    });
    const plan = {
      base: { enabled: false },
      tiers: { enabled: false },
      package_sale: { enabled: true, calc: { kind: 'PCT', bps: 1000 } },
    };
    await insertCommissionPlanVersion(tx, A, ids, {
      effectiveFrom: '2026-10-01',
      plan,
    });
    await insertCommissionPlanVersion(tx, A, ids, {
      employeeId: COMMISSION_LINE_IDS.secondEmployee,
      effectiveFrom: '2026-10-01',
      plan,
    });
  });
}

/** يجمّد كشف شهر المصدر مع صف بيع مجمّد بثلاثة دنانير ولقطة ارتباط الموظفة. */
async function seedFrozenStatement(status: 'APPROVED' | 'PAID' = 'APPROVED'): Promise<void> {
  await walkCommissionStatement(db, {
    tenant: A,
    period: SOURCE_PERIOD,
    ids,
    to: status,
    afterApproved: async (tx, statementId) => {
      await insertCommissionLine(tx, A, statementId, ids, {
        kind: 'SALE',
        sourceRef: `sale:${SALE_ID}`,
        amount: '3.000',
        sourceBranchId: A.branch,
        sourceBusinessDate: SALE_DATE,
        attachedBranchIds: [A.branch],
      });
      await insertCommissionAttachment(tx, A, statementId, ids, {});
    },
  });
}

const saleEvent = (overrides: Record<string, unknown> = {}) =>
  commissionSaleEvent(A, ids, {
    saleId: SALE_ID,
    businessDate: SALE_DATE,
    pricePaid: '30.000',
    refundedAmount: '10.000',
    revision: 2,
    ...overrides,
  });

const ledger = () =>
  owner`SELECT source_ref AS "sourceRef", kind, amount::text AS amount,
    previous_amount::text AS "previousAmount", new_amount::text AS "newAmount", generation,
    source_period AS "sourcePeriod", target_period AS "targetPeriod",
    employee_id AS "employeeId", source_branch_id AS "sourceBranchId",
    source_business_date::text AS "sourceBusinessDate",
    attached_branch_ids AS "attachedBranchIds"
    FROM commission_corrections WHERE company_id=${A.company}
    ORDER BY generation, source_ref`;

const saleRow = () =>
  owner`SELECT sale_id AS "saleId", status, price_paid::text AS "pricePaid",
    refunded_amount::text AS "refundedAmount", revision, period
    FROM commission_sales WHERE company_id=${A.company} AND sale_id=${SALE_ID}`;

const generations = () =>
  owner`SELECT generation FROM commission_period_generations WHERE company_id=${A.company}`;

const marks = () =>
  owner`SELECT event_id FROM consumed_events
    WHERE consumer_id='commissions.project-inputs' ORDER BY event_id`;

it('records -1.000 for a partial refund against the frozen 3.000', async () => {
  expect(await deliver(saleEvent())).toMatchObject({ delivered: true });
  expect(failures.size).toBe(0);
  expect(await ledger()).toEqual([
    {
      sourceRef: `sale:${SALE_ID}`,
      kind: 'SALE',
      amount: '-1.000',
      previousAmount: '3.000',
      newAmount: '2.000',
      generation: 1,
      sourcePeriod: SOURCE_PERIOD,
      targetPeriod: TARGET_PERIOD,
      employeeId: A.employee,
      sourceBranchId: A.branch,
      sourceBusinessDate: SALE_DATE,
      attachedBranchIds: [A.branch],
    },
  ]);
});

it('records -2.000 for a full refund on top of the published -1.000', async () => {
  await deliver(saleEvent());
  await deliver(saleEvent({ revision: 3, refundedAmount: '30.000' }));
  expect(await ledger()).toEqual([
    {
      sourceRef: `sale:${SALE_ID}`,
      kind: 'SALE',
      amount: '-1.000',
      previousAmount: '3.000',
      newAmount: '2.000',
      generation: 1,
      sourcePeriod: SOURCE_PERIOD,
      targetPeriod: TARGET_PERIOD,
      employeeId: A.employee,
      sourceBranchId: A.branch,
      sourceBusinessDate: SALE_DATE,
      attachedBranchIds: [A.branch],
    },
    {
      sourceRef: `sale:${SALE_ID}`,
      kind: 'SALE',
      amount: '-2.000',
      previousAmount: '2.000',
      newAmount: '0.000',
      generation: 2,
      sourcePeriod: SOURCE_PERIOD,
      targetPeriod: TARGET_PERIOD,
      employeeId: A.employee,
      sourceBranchId: A.branch,
      sourceBusinessDate: SALE_DATE,
      attachedBranchIds: [A.branch],
    },
  ]);
});

it('leaves the ledger unchanged when the same revision is delivered again', async () => {
  await deliver(saleEvent());
  await deliver(saleEvent({ revision: 3, refundedAmount: '30.000' }));
  const before = await ledger();
  expect(await deliver(saleEvent({ revision: 3, refundedAmount: '30.000', id: ids.newId() }))).toMatchObject(
    { delivered: true },
  );
  expect(await ledger()).toEqual(before);
  expect(before).toHaveLength(2);
});

it('keeps the stored SOLD status, the paid price and the cumulative refund on the projection', async () => {
  await deliver(saleEvent());
  const rows = await owner`SELECT status, price_paid::text AS "pricePaid",
    refunded_amount::text AS "refundedAmount", revision, period
    FROM commission_sales WHERE company_id=${A.company} AND sale_id=${SALE_ID}`;
  expect(rows).toEqual([
    {
      status: 'SOLD',
      pricePaid: '30.000',
      refundedAmount: '10.000',
      revision: 2,
      period: SOURCE_PERIOD,
    },
  ]);
});

it('revokes the frozen amount when the sale moves to another month', async () => {
  await deliver(saleEvent({ businessDate: '2026-11-02' }));
  expect(await ledger()).toEqual([
    {
      sourceRef: `sale:${SALE_ID}`,
      kind: 'SALE',
      amount: '-3.000',
      previousAmount: '3.000',
      newAmount: '0.000',
      generation: 1,
      sourcePeriod: SOURCE_PERIOD,
      targetPeriod: TARGET_PERIOD,
      employeeId: A.employee,
      sourceBranchId: A.branch,
      sourceBusinessDate: SALE_DATE,
      attachedBranchIds: [A.branch],
    },
  ]);
});

it('revokes the old seller and adds the new seller in the same closed month', async () => {
  await deliver(saleEvent({ sellerEmployeeId: COMMISSION_LINE_IDS.secondEmployee }));
  const rows = await ledger();
  expect(rows).toHaveLength(2);
  const pairs = rows.map((row) => [row.employeeId, row.amount] as const);
  expect(pairs).toContainEqual([A.employee, '-3.000']);
  // البائع الجديد بياخد المبلغ المعاد حسابه بعد المرتجع: (30.000 - 10.000) بنسبة 10% = 2.000.
  expect(pairs).toContainEqual([COMMISSION_LINE_IDS.secondEmployee, '2.000']);
  const [added] = rows.filter((row) => row.employeeId === COMMISSION_LINE_IDS.secondEmployee);
  expect(added).toMatchObject({
    sourceRef: `sale:${SALE_ID}`,
    kind: 'SALE',
    previousAmount: '0.000',
    newAmount: '2.000',
    sourceBranchId: A.branch,
    sourceBusinessDate: SALE_DATE,
    attachedBranchIds: [],
  });
});

it('records a block and no correction when the seller has no applicable plan', async () => {
  await owner`DELETE FROM commission_plan_versions WHERE employee_id=${A.employee}`;
  expect(await deliver(saleEvent())).toMatchObject({ delivered: true });
  expect(await ledger()).toHaveLength(0);
  const blocks = await owner`SELECT code, source_period AS "sourcePeriod", target_period AS "targetPeriod"
    FROM commission_blocked_corrections WHERE company_id=${A.company}`;
  expect(blocks).toEqual([{ code: 'NO_PLAN', sourcePeriod: SOURCE_PERIOD, targetPeriod: TARGET_PERIOD }]);
});

it('corrects a paid month the same way it corrects an approved one', async () => {
  // الشهر المدفوع بيتجمّد من الأول، فالكشف المعتمد بيتشال الأول.
  await owner`DELETE FROM commission_statement_attachments`;
  await owner`DELETE FROM commission_statement_lines`;
  await owner`DELETE FROM commission_statements`;
  await seedFrozenStatement('PAID');
  expect(await deliver(saleEvent())).toMatchObject({ delivered: true });

  const rows = await ledger();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    sourceRef: `sale:${SALE_ID}`,
    kind: 'SALE',
    amount: '-1.000',
    previousAmount: '3.000',
    newAmount: '2.000',
    sourcePeriod: SOURCE_PERIOD,
    targetPeriod: TARGET_PERIOD,
  });
});

/**
 * مستهلك بيفشل عند كتابة التصحيح بعد ما صف البيع اتكتب، عشان يثبت إن
 * المعاملة رجعت بالكامل: مفيش صف ولا جيل ولا تصحيح ولا علامة استهلاك.
 */
function failingCorrectionConsumer(): OutboxConsumer {
  return {
    id: consumer.id,
    eventTypes: consumer.eventTypes,
    handle: async (tx, event) => {
      const scope = createCommissionSaleProjectionScope(tx, fakeBusinessTimeZone(A.business), ids);
      const corrections = createCommissionCorrectionScope(tx, ids, clock);
      const failing = {
        ...corrections,
        insertCorrections: async (): Promise<void> => {
          throw new Error('injected correction failure');
        },
      };
      const notices = createCommissionBlockNotices(tx, ids, clock, {
        groupSize: commissionCorrectionBlockedNoticeGroupSize,
        parsePayload: (payload: unknown) => commissionCorrectionBlockedNoticeRequested.parse(payload),
        permissionHolders: noPermissionHolders,
      });
      const sales = new ProjectPackageSale(scope, clock, ids, failing, notices);
      const useCases = { lines: null, tips: null, salary: null, sales } as unknown as CommissionInputUseCases;
      await onCommissionInputEvent(useCases, event);
    },
  };
}

it('leaves nothing behind when the correction write fails in a closed month, and a redelivery projects once', async () => {
  const failing = createDeliverer(db, [failingCorrectionConsumer()], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  const event = saleEvent();

  await failing(event);
  expect(await saleRow()).toHaveLength(1);
  expect(await ledger()).toHaveLength(0);
  expect(await generations()).toHaveLength(0);
  expect(await marks()).toHaveLength(0);

  expect(await deliver(event)).toMatchObject({ delivered: true });
  expect(await saleRow()).toHaveLength(1);
  expect(await ledger()).toHaveLength(1);
  expect(await marks()).toHaveLength(1);
});
