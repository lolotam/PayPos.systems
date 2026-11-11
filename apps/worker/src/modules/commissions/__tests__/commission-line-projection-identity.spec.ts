import { serviceLineChanged } from '@pospay/contracts';
import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  OTHER_COMMISSION_IDS,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { CommissionLineEventInput } from '../domain/commission-line-types.ts';
import { CommissionLineEventInvalidError } from '../domain/errors.ts';
import {
  onCommissionInputEvent,
  type CommissionInputUseCases,
} from '../events/handlers/on-commission-input-event.handler.ts';
import { createCommissionLineProjectionScope } from '../persistence/commission-line-projection.scope.ts';
import {
  normalizeCommissionLineEvent,
  ProjectServiceLines,
} from '../use-cases/project-service-lines/project-service-lines.ts';

const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const other = OTHER_COMMISSION_IDS;
const alternateBranch = '01920000-0000-7000-8000-00000000e801';
const alternateService = '01920000-0000-7000-8000-00000000e802';
const alternateCustomer = '01920000-0000-7000-8000-00000000e803';
let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let month = 0;
let businessDate: string;
let timezoneRequests = 0;
let periodRequests = 0;
const clock = { now: () => new Date(`${businessDate}T12:00:00Z`) };
const businessTimeZone = async () => {
  timezoneRequests += 1;
  return 'Asia/Kuwait';
};
const consumer = createTestCommissionInputsConsumer({
  ids,
  clock,
  businessTimeZone,
});

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${A.company},${alternateBranch},${A.business},'Identity alternative')`;
  await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${A.company},${alternateService},${A.business},'Identity alternative',1.000,'ZERO')`;
  await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${A.company},${alternateCustomer},'Identity alternative','+96500000802','ar',now(),now())`;
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_lines WHERE company_id=${A.company}`;
  await owner`DELETE FROM commission_line_heads WHERE company_id=${A.company}`;
  await owner`DELETE FROM consumed_events
    WHERE company_id=${A.company} AND consumer_id='commissions.project-inputs'`;
  month += 1;
  businessDate = `2027-${String(month).padStart(2, '0')}-05`;
  timezoneRequests = 0;
  periodRequests = 0;
});

function event(row: Record<string, unknown> = {}): ClaimedEvent {
  return commissionLineEvent(A, ids, 'ServiceLineChanged', {
    businessDate,
    occurredAt: `${businessDate}T09:00:00Z`,
    recordedAt: `${businessDate}T09:00:00Z`,
    ...row,
  });
}

const deliver = (incoming: ClaimedEvent) =>
  createDeliverer(db, [consumer], createLogger('silent'), { knownEventTypes: consumer.eventTypes })(
    incoming,
  );

async function projectionState() {
  return {
    heads: await owner`SELECT * FROM commission_line_heads ORDER BY company_id,line_id`,
    performers: await owner`SELECT * FROM commission_lines ORDER BY company_id,line_id,employee_id`,
    statements:
      await owner`SELECT * FROM commission_statements ORDER BY company_id,business_id,period`,
    marks: await owner`SELECT * FROM consumed_events
      WHERE consumer_id='commissions.project-inputs' ORDER BY company_id,event_id`,
  };
}

async function instrumentedAttempt(incoming: ClaimedEvent | CommissionLineEventInput) {
  return db.withTenant(A.company, async (tx) => {
    const scope = createCommissionLineProjectionScope(tx, businessTimeZone);
    const observed = {
      ...scope,
      lockPeriods: async (input: Parameters<typeof scope.lockPeriods>[0]) => {
        periodRequests += 1;
        return scope.lockPeriods(input);
      },
    };
    const useCase = new ProjectServiceLines(observed, clock, ids);
    if ('eventType' in incoming) {
      const unusedUseCase = {
        execute: async () => {
          throw new Error('unused in lines test');
        },
      } as unknown as CommissionInputUseCases['tips'] & CommissionInputUseCases['salary'];
      await onCommissionInputEvent(
        { lines: useCase, tips: unusedUseCase, salary: unusedUseCase },
        incoming,
      );
    } else await useCase.execute(incoming);
  });
}

const identityChanges = [
  { field: 'session', row: { sessionId: other.session } },
  { field: 'branch', row: { branchId: alternateBranch } },
  { field: 'service', row: { serviceId: alternateService } },
  { field: 'customer', row: { customerId: alternateCustomer } },
  // مراجع النشاط تتبدل معاً لتظل صالحة للـ FK؛ فشل التسليم هنا ليس رفض مرجع مفقود.
  {
    field: 'business',
    row: {
      businessId: other.business,
      branchId: other.branch,
      serviceId: other.service,
      performers: [{ employee_id: other.employee, share_bps: 10000 }],
    },
  },
];

it.each(identityChanges)(
  '#802 newer $field identity fails before timezone/periods with no effects',
  async ({ row }) => {
    expect(await deliver(event())).toEqual({ delivered: true });
    await walkCommissionStatement(db, {
      tenant: A,
      period: businessDate.slice(0, 7),
      ids,
      to: 'REVIEWED',
    });
    const before = await projectionState();
    const incoming = event({ revision: 2, ...row });
    timezoneRequests = 0;
    const failure = await instrumentedAttempt(incoming).then(
      () => null,
      (error: unknown) => error,
    );
    expect.soft(failure).toBeInstanceOf(CommissionLineEventInvalidError);
    expect
      .soft(failure)
      .toMatchObject({ reason: 'IDENTITY_CHANGED', lineId: COMMISSION_LINE_IDS.lineA });
    expect.soft(timezoneRequests).toBe(0);
    expect.soft(periodRequests).toBe(0);
    expect.soft(await projectionState()).toEqual(before);
    expect.soft(await deliver(incoming)).toMatchObject({ delivered: false });
    expect.soft(timezoneRequests).toBe(0);
    expect(await projectionState()).toEqual(before);
  },
);

it('#802 a mixed batch leaves valid updates, unseen lines, statements and delivery marks untouched', async () => {
  const dates = {
    businessDate,
    occurredAt: `${businessDate}T09:00:00Z`,
    recordedAt: `${businessDate}T09:00:00Z`,
  };
  const recorded = commissionLineEvent(A, ids, 'ServiceSessionRecorded', {
    ...dates,
    lines: [
      { lineId: COMMISSION_LINE_IDS.lineA, ...dates },
      { lineId: COMMISSION_LINE_IDS.lineB, ...dates },
    ],
  });
  expect(await deliver(recorded)).toEqual({ delivered: true });
  await walkCommissionStatement(db, {
    tenant: A,
    period: businessDate.slice(0, 7),
    ids,
    to: 'REVIEWED',
  });
  const before = await projectionState();
  // عقود التسجيل تقبل revision=1 فقط؛ اختبار الدفعة الأحدث يخص مدخل الـ use case الموحّد.
  const snapshots = [
    event({ lineId: COMMISSION_LINE_IDS.lineB, revision: 2, net: '20.001' }),
    event({ lineId: other.line }),
    event({ revision: 2, serviceId: alternateService }),
  ].map((incoming) =>
    normalizeCommissionLineEvent(incoming, serviceLineChanged.parse(incoming.payload)),
  );
  const incoming: CommissionLineEventInput = {
    companyId: A.company,
    businessId: A.business,
    sessionId: COMMISSION_LINE_IDS.sessionA,
    lines: snapshots.flatMap((snapshot) => snapshot.lines),
  };
  timezoneRequests = 0;
  const failure = await instrumentedAttempt(incoming).then(
    () => null,
    (error: unknown) => error,
  );
  expect.soft(failure).toBeInstanceOf(CommissionLineEventInvalidError);
  expect
    .soft(failure)
    .toMatchObject({ reason: 'IDENTITY_CHANGED', lineId: COMMISSION_LINE_IDS.lineA });
  expect.soft(timezoneRequests).toBe(0);
  expect.soft(periodRequests).toBe(0);
  expect.soft(await projectionState()).toEqual(before);
});

it.each([1, 2])(
  '#802 conflicting revision %i is ignored and marked without calendar requests',
  async (revision) => {
    expect(await deliver(event({ revision: 2 }))).toEqual({ delivered: true });
    const before = await projectionState();
    for (const { row } of identityChanges) {
      const incoming = event({ revision, ...row });
      timezoneRequests = 0;
      await instrumentedAttempt(incoming);
      expect(timezoneRequests).toBe(0);
      expect(periodRequests).toBe(0);
      expect(await deliver(incoming)).toEqual({ delivered: true });
      expect(timezoneRequests).toBe(0);
    }
    const after = await projectionState();
    expect(after.heads).toEqual(before.heads);
    expect(after.performers).toEqual(before.performers);
    expect(after.statements).toEqual(before.statements);
    expect(after.marks).toHaveLength(before.marks.length + identityChanges.length);
  },
);

it('#802 real held-head read retains all identity fields under the tenant line lock', async () => {
  expect(await deliver(event())).toEqual({ delivered: true });
  const heads = await db.withTenant(A.company, async (tx) => {
    const scope = createCommissionLineProjectionScope(tx, businessTimeZone);
    await scope.lockLines([COMMISSION_LINE_IDS.lineA]);
    return scope.readHeads([COMMISSION_LINE_IDS.lineA]);
  });
  expect(heads).toEqual([
    {
      lineId: COMMISSION_LINE_IDS.lineA,
      revision: 1,
      period: businessDate.slice(0, 7),
      businessId: A.business,
      sessionId: COMMISSION_LINE_IDS.sessionA,
      branchId: A.branch,
      serviceId: A.service,
      customerId: A.customer,
    },
  ]);
});

it('#802 same-identity newer changes replace performers and move the legitimate month', async () => {
  expect(await deliver(event())).toEqual({ delivered: true });
  const oldPeriod = businessDate.slice(0, 7);
  const nextDate = '2027-12-05';
  await walkCommissionStatement(db, { tenant: A, period: oldPeriod, ids, to: 'REVIEWED' });
  expect(
    await deliver(
      event({
        revision: 2,
        businessDate: nextDate,
        occurredAt: `${nextDate}T09:00:00Z`,
        recordedAt: `${nextDate}T09:00:00Z`,
        net: '20.001',
        counts: false,
        ruleSnapshot: { kind: 'PCT', value: 500 },
        performers: [{ employee_id: COMMISSION_LINE_IDS.secondEmployee, share_bps: 10000 }],
      }),
    ),
  ).toEqual({ delivered: true });
  const after = await projectionState();
  expect(after.heads).toHaveLength(1);
  expect(after.heads[0]).toMatchObject({
    revision: 2,
    period: '2027-12',
    business_id: A.business,
    session_id: COMMISSION_LINE_IDS.sessionA,
    branch_id: A.branch,
    service_id: A.service,
    customer_id: A.customer,
  });
  expect(after.performers).toHaveLength(1);
  expect(after.performers[0]).toMatchObject({
    employee_id: COMMISSION_LINE_IDS.secondEmployee,
    net: '20.001',
    net_share: '20.001',
    period: '2027-12',
    counts: false,
    rule_kind: 'PCT',
    rule_pct_bps: 500,
  });
  expect(
    after.statements.find((row) => row.business_id === A.business && row.period === oldPeriod),
  ).toMatchObject({ status: 'DRAFT', reviewed_at: null });
  expect(after.marks).toHaveLength(2);
});
