import { createDatabase, OWNER_ROLE_ID, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
  type CommissionLineTenant,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  revisionRow,
  tipRow,
  writeRevision,
  type TipCtx,
} from '../../../../../../packages/db/test/session-tip.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestCommissionTipsBootstrap,
  type CommissionTipsBootstrapScope,
} from '../../../__tests__/commission-tips-bootstrap.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { type CurrentTipSessionsReader } from '../index.ts';
import { commissionTipEvent } from './commission-tip-salary-events.ts';

export type Method = 'CASH' | 'CARD';
export type TipInput = { readonly employeeId: string; readonly method: Method; readonly amount: string };
type ConsumerDependencies = Parameters<typeof createTestCommissionInputsConsumer>[0];
type TipEventOverrides = Parameters<typeof commissionTipEvent>[2];

export let testDb: TestDatabase;
export let owner: postgres.Sql;
export let db: Database;
export let deliver: (event: ClaimedEvent) => Promise<unknown>;
export const ids = systemUuidV7();
export const { A, B } = COMMISSION_LINE_TENANTS;
export const CUSTOMER_A = COMMISSION_LINE_IDS.customerA;
export const CUSTOMER_B = COMMISSION_LINE_IDS.customerB;
export const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
export const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const SCOPE: CommissionTipsBootstrapScope = {
  companyId: A.company,
  businessIds: [A.business],
  from: '2026-11-01',
  to: '2026-12-31',
};
export const businessTimeZone: ConsumerDependencies['businessTimeZone'] = async (
  _tx,
  _companyId,
  businessId,
) => (businessId === A.business || businessId === B.business ? 'Asia/Kuwait' : null);

/** يسجّل خطافات vitest التي تجهّز قاعدة بيانات التهيئة وتفريغها بين كل اختبار. */
export function useBootstrapHarness(): void {
  beforeAll(async () => {
    testDb = await createTestDatabase();
    await seedCommissionLineTenants(testDb.ownerUrl);
    owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
    db = createDatabase({ url: testDb.appUrl, ids });
    await seedRecorder();
    const consumer = createTestCommissionInputsConsumer({ ids, clock, businessTimeZone });
    deliver = createDeliverer(db, [consumer], createLogger('silent'), {
      knownEventTypes: consumer.eventTypes,
    });
  });

  afterAll(async () => {
    await db?.close();
    await owner?.end();
    await testDb?.drop();
  });

  beforeEach(async () => {
    await owner`DELETE FROM commission_tips`;
    await owner`DELETE FROM commission_tip_heads`;
    await owner`DELETE FROM commission_statements`;
    await owner`DELETE FROM session_tips`;
    await owner`DELETE FROM session_tip_revisions`;
    await owner`DELETE FROM service_sessions`;
    await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  });
}

export async function seedRecorder(): Promise<void> {
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${USER},'Synthetic recorder','tips-bootstrap@example.test',true,now(),now())
    ON CONFLICT DO NOTHING`;
  for (const tenant of [A, B]) {
    await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES(${tenant.company},${ORDER_IDS.membership},${USER},${OWNER_ROLE_ID},'global','COMPANY',${tenant.company})
      ON CONFLICT DO NOTHING`;
  }
}

export const tip = (employeeId: string, method: Method, amount: string) => ({ employeeId, method, amount });
export const eventTip = (emp: string, method: Method, amount: string) => ({ employee_id: emp, method, amount });
export const tipEvent = (
  id: string,
  sessionId: string,
  revision: number,
  tips: NonNullable<NonNullable<TipEventOverrides>['tips']>,
) => commissionTipEvent(A, ids, { id, sessionId, revision, businessDate: '2026-12-02', tips });
export const tipCtx = (tenant: CommissionLineTenant): TipCtx => ({
  company: tenant.company,
  business: tenant.business,
  branch: tenant.branch,
  userId: USER,
  membershipId: ORDER_IDS.membership,
  sessionId: '',
  employeeId: tenant.employee,
});
export const seedSession = async (
  tenant: CommissionLineTenant,
  businessDate: string,
  customerId: string,
) => {
  const ctx = tipCtx(tenant);
  const sessionId = ids.newId();
  await owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late)
    VALUES(${ctx.company},${sessionId},${ctx.business},${ctx.branch},${customerId},'Synthetic customer','***123',
      ${ctx.userId},${ctx.membershipId},now(),now(),${businessDate}::date,'Asia/Kuwait',false)`;
  return { ctx, sessionId };
};

export async function writeTipRevision(
  ctx: TipCtx,
  sessionId: string,
  revision: number,
  event: string,
  tips: readonly TipInput[],
): Promise<string> {
  const row = revisionRow(ids, sessionId, revision, { eventId: event });
  const rows = tips.map((entry) => tipRow(ids, row.id, sessionId, { ...entry }));
  await writeRevision(db, ctx, row, rows);
  return row.eventId;
}

export const bootstrap = (wrapReader?: (real: CurrentTipSessionsReader) => CurrentTipSessionsReader) => {
  const dependencies = { ids, clock, businessTimeZone, database: db };
  return createTestCommissionTipsBootstrap(
    wrapReader === undefined ? dependencies : { ...dependencies, wrapReader },
  );
};
export type BootstrapResult = Awaited<ReturnType<ReturnType<typeof bootstrap>>>;
export const headOf = async (sessionId: string) => {
  const [row] = await owner`SELECT business_id, branch_id, revision, business_date::text AS business_date, period
    FROM commission_tip_heads WHERE session_id=${sessionId}`;
  return row;
};
export const revisionOf = async (sessionId: string) => (await headOf(sessionId))?.revision;
export const rowsOf = (sessionId: string) =>
  owner`SELECT employee_id, method, amount::text AS amount FROM commission_tips
    WHERE session_id=${sessionId} ORDER BY employee_id, method`;
export const expectRows = async (sessionId: string, expected: readonly unknown[]) =>
  expect(await rowsOf(sessionId)).toEqual(expected);
export const markedIds = async () =>
  (await owner`SELECT event_id FROM consumed_events
    WHERE consumer_id='commissions.project-inputs' ORDER BY event_id`).map((row) => row.event_id);
export const outboxSnapshot = (companyId: string) =>
  owner`SELECT id, published_at, attempts, next_attempt_at, parked_at, last_error
    FROM outbox WHERE company_id=${companyId} ORDER BY id`;

export async function insertOutbox(aggregateId: string, event: string): Promise<void> {
  await owner`INSERT INTO outbox (
    company_id, id, aggregate_type, aggregate_id, event_type, payload,
    published_at, attempts, next_attempt_at, parked_at, last_error
  ) VALUES (
    ${A.company}, ${event}, 'service_session', ${aggregateId}, 'SessionTipsChanged',
    ${owner.json({ session_id: aggregateId })}, ${new Date('2026-11-01T10:00:00Z')}, 1,
    clock_timestamp(), null, null
  )`;
}
