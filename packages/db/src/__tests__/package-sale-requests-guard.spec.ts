import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { insertSaleRequest, type SaleRequestTenant } from '../../test/package-sale-request-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;

const PACKAGE_TYPE_ID = randomUUID();
const ENTITLEMENT_ID = randomUUID();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  app = postgres(testDb.appUrl, { max: 2, onnotice: () => undefined });

  const COMPONENT_ID = randomUUID();
  await owner`INSERT INTO package_types(company_id, id, business_id, name_en, price, validity_days)
    VALUES (${TENANT.A.company}, ${PACKAGE_TYPE_ID}, ${TENANT.A.business}, 'Guard package type', 30.000, 30)`;

  await owner.begin(async (tx) => {
    await tx`INSERT INTO package_entitlements (
      company_id, id, business_id, customer_id, package_type_id, provenance, name_en, validity_days,
      list_price, price_paid, discount, discount_bps, paid_method, seller_employee_id, sold_branch_id,
      sold_at, sold_business_date, sold_timezone, recorded_by, recorded_by_membership_id, expires_on,
      refunded_amount, revision
    ) VALUES (
      ${TENANT.A.company}, ${ENTITLEMENT_ID}, ${TENANT.A.business}, ${ORDER_IDS.customer}, ${PACKAGE_TYPE_ID}, 'SOLD',
      'Guard test entitlement', 30, 30.000, 30.000, 0, 0, 'CASH', ${ORDER_IDS.employee}, ${TENANT.A.branch},
      now(), current_date, 'Asia/Kuwait', ${USER}, ${ORDER_IDS.membership}, current_date + 30, 0, 1
    )`;
    await tx`INSERT INTO package_components (
      company_id, id, business_id, entitlement_id, service_id, position, name_en, list_price_snapshot,
      sessions_total, component_value
    ) VALUES (
      ${TENANT.A.company}, ${COMPONENT_ID}, ${TENANT.A.business}, ${ENTITLEMENT_ID}, ${ORDER_IDS.service}, 1,
      'Synthetic service', 10.000, 3, 30.000
    )`;
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await tx`INSERT INTO package_session_slots (
        company_id, id, business_id, entitlement_id, component_id, ordinal, unit_value, state
      ) VALUES (
        ${TENANT.A.company}, ${randomUUID()}, ${TENANT.A.business}, ${ENTITLEMENT_ID}, ${COMPONENT_ID},
        ${ordinal}, 10.000, 'FREE'
      )`;
    }
  });
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await testDb?.drop();
});

async function asApp<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
  tenant: SaleRequestTenant = TENANT.A,
) {
  return app.begin(async (tx) => {
    await tx`SELECT set_config('app.company_id', ${tenant.company}, true), set_config('app.user_id', ${USER}, true)`;
    return work(tx);
  });
}

function insertPendingRequest(tx: postgres.TransactionSql, overrides: Record<string, unknown> = {}) {
  return insertSaleRequest(tx, { package_type_id: PACKAGE_TYPE_ID, ...overrides });
}

const FINISHED = new Date('2026-11-11T12:00:00Z');

it.each([
  ['completed', { status: 'completed', entitlement_id: ENTITLEMENT_ID, finished_at: FINISHED }],
  ['failed', { status: 'failed', error_code: 'PACKAGE_SALE_FAILED', finished_at: FINISHED }],
])('an insert as %s is refused by the guard trigger', async (_status, overrides) => {
  await expect(asApp((tx) => insertPendingRequest(tx, overrides))).rejects.toMatchObject({
    code: '23514',
    message: 'PACKAGE_SALE_REQUEST_INITIAL_STATUS_INVALID',
  });
});

it('each legal transition (pending -> completed, pending -> failed) succeeds', async () => {
  const req1 = await asApp((tx) => insertPendingRequest(tx));
  await asApp((tx) =>
    tx`UPDATE package_sale_requests
       SET status = 'completed', entitlement_id = ${ENTITLEMENT_ID}, finished_at = now()
       WHERE id = ${req1}`,
  );
  const rows1 = await asApp(
    (tx) => tx`SELECT status, entitlement_id, error_code FROM package_sale_requests WHERE id = ${req1}`,
  );
  expect(rows1).toEqual([{ status: 'completed', entitlement_id: ENTITLEMENT_ID, error_code: null }]);

  const req2 = await asApp((tx) => insertPendingRequest(tx));
  await asApp((tx) =>
    tx`UPDATE package_sale_requests
       SET status = 'failed', error_code = 'PACKAGE_CUSTOMER_NOT_FOUND',
           error_details = '{"reason":"test"}'::jsonb, finished_at = now()
       WHERE id = ${req2}`,
  );
  const rows2 = await asApp(
    (tx) => tx`SELECT status, error_code, error_details FROM package_sale_requests WHERE id = ${req2}`,
  );
  expect(rows2[0]).toMatchObject({ status: 'failed', error_code: 'PACKAGE_CUSTOMER_NOT_FOUND' });

  const req3 = await asApp((tx) => insertPendingRequest(tx));
  await asApp((tx) =>
    tx`UPDATE package_sale_requests
       SET status = 'failed', error_code = 'PACKAGE_SALE_FAILED', finished_at = now()
       WHERE id = ${req3}`,
  );
  const rows3 = await asApp(
    (tx) => tx`SELECT status, error_code, error_details FROM package_sale_requests WHERE id = ${req3}`,
  );
  expect(rows3).toEqual([{ status: 'failed', error_code: 'PACKAGE_SALE_FAILED', error_details: null }]);
});

it('every refused transition gives 23514', async () => {
  const compId = await asApp((tx) => insertPendingRequest(tx));
  await asApp((tx) =>
    tx`UPDATE package_sale_requests
       SET status = 'completed', entitlement_id = ${ENTITLEMENT_ID}, finished_at = now()
       WHERE id = ${compId}`,
  );

  // من completed لـ failed: الحالة النهائية ما بتتغيرش.
  await expect(
    asApp((tx) =>
      tx`UPDATE package_sale_requests
         SET status = 'failed', error_code = 'PACKAGE_SALE_FAILED', entitlement_id = NULL
         WHERE id = ${compId}`,
    ),
  ).rejects.toMatchObject({ code: '23514', message: 'PACKAGE_SALE_REQUEST_TRANSITION_INVALID' });

  // أي تعديل على صف completed مرفوض.
  await expect(
    asApp((tx) =>
      tx`UPDATE package_sale_requests
         SET finished_at = now() + interval '1 minute'
         WHERE id = ${compId}`,
    ),
  ).rejects.toMatchObject({ code: '23514', message: 'PACKAGE_SALE_REQUEST_TRANSITION_INVALID' });

  const failId = await asApp((tx) => insertPendingRequest(tx));
  await asApp((tx) =>
    tx`UPDATE package_sale_requests
       SET status = 'failed', error_code = 'PACKAGE_SALE_FAILED', finished_at = now()
       WHERE id = ${failId}`,
  );

  // من failed لـ pending: الطلب الفاشل ما يرجعش للطابور.
  await expect(
    asApp((tx) =>
      tx`UPDATE package_sale_requests
         SET status = 'pending', error_code = NULL, finished_at = NULL
         WHERE id = ${failId}`,
    ),
  ).rejects.toMatchObject({ code: '23514', message: 'PACKAGE_SALE_REQUEST_TRANSITION_INVALID' });

  // أي تعديل على صف failed مرفوض.
  await expect(
    asApp((tx) =>
      tx`UPDATE package_sale_requests
         SET error_code = 'ANOTHER_ERROR'
         WHERE id = ${failId}`,
    ),
  ).rejects.toMatchObject({ code: '23514', message: 'PACKAGE_SALE_REQUEST_TRANSITION_INVALID' });

  // من pending لـ pending بتعديل: التحديث لازم يكون انتقال لحالة نهائية.
  const pendId = await asApp((tx) => insertPendingRequest(tx));
  await expect(
    asApp((tx) =>
      tx`UPDATE package_sale_requests
         SET status = 'pending', finished_at = now()
         WHERE id = ${pendId}`,
    ),
  ).rejects.toMatchObject({ code: '23514', message: 'PACKAGE_SALE_REQUEST_TRANSITION_INVALID' });
});

const STATE_SHAPE_REFUSED = { code: '23514', constraint_name: 'package_sale_requests_state_shape_check' };

it.each([
  ['completed without entitlement_id', { status: 'completed', finished_at: FINISHED }],
  ['completed without finished_at', { status: 'completed', entitlement_id: ENTITLEMENT_ID }],
  ['completed with error_code', { status: 'completed', entitlement_id: ENTITLEMENT_ID, error_code: 'ERR', finished_at: FINISHED }],
  ['completed with error_details', { status: 'completed', entitlement_id: ENTITLEMENT_ID, error_details: { reason: 'x' }, finished_at: FINISHED }],
  ['failed without error_code', { status: 'failed', finished_at: FINISHED }],
  ['failed without finished_at', { status: 'failed', error_code: 'ERR' }],
  ['failed with entitlement_id', { status: 'failed', error_code: 'ERR', entitlement_id: ENTITLEMENT_ID, finished_at: FINISHED }],
])('a pending request moved to %s is refused by the state shape check', async (_shape, changes) => {
  const id = await asApp((tx) => insertPendingRequest(tx));
  await expect(
    asApp((tx) => {
      const row = 'error_details' in changes ? { ...changes, error_details: tx.json(changes.error_details) } : changes;
      return tx`UPDATE package_sale_requests SET ${tx(row)} WHERE id = ${id}`;
    }),
  ).rejects.toMatchObject(STATE_SHAPE_REFUSED);
});

it('a pending insert that already carries a result is refused by the state shape check', async () => {
  await expect(asApp((tx) => insertPendingRequest(tx, { error_code: 'ERR' }))).rejects.toMatchObject(STATE_SHAPE_REFUSED);
});

// المالك بيعدّي صلاحيات الأعمدة، فده بيثبت إن الـ trigger نفسه هو اللي قافل جسم الطلب مش الـ grants بس.
it.each([
  ['price_paid', 50.0],
  ['customer_id', '01920000-0000-7000-8000-00000000a001'],
  ['expected_type_revision', 2],
])('a legal transition that also changes %s is refused as a body change', async (column, value) => {
  const id = await asApp((tx) => insertPendingRequest(tx));
  await expect(
    owner`UPDATE package_sale_requests
          SET status = 'completed', entitlement_id = ${ENTITLEMENT_ID}, finished_at = now(), ${owner({ [column]: value })}
          WHERE company_id = ${TENANT.A.company} AND id = ${id}`,
  ).rejects.toMatchObject({ code: '23514', message: 'PACKAGE_SALE_REQUEST_BODY_IMMUTABLE' });
});

it('pospay_app has no DELETE grant and no UPDATE grant on body columns', async () => {
  const id = await asApp((tx) => insertPendingRequest(tx));

  await expect(
    asApp((tx) => tx`DELETE FROM package_sale_requests WHERE id = ${id}`),
  ).rejects.toMatchObject({ code: '42501' });

  await expect(
    asApp((tx) => tx`TRUNCATE package_sale_requests`),
  ).rejects.toMatchObject({ code: '42501' });

  for (const query of [
    (tx: postgres.TransactionSql) => tx`UPDATE package_sale_requests SET customer_id = ${randomUUID()} WHERE id = ${id}`,
    (tx: postgres.TransactionSql) => tx`UPDATE package_sale_requests SET price_paid = 50.000 WHERE id = ${id}`,
    (tx: postgres.TransactionSql) => tx`UPDATE package_sale_requests SET paid_method = 'CARD' WHERE id = ${id}`,
    (tx: postgres.TransactionSql) => tx`UPDATE package_sale_requests SET seller_employee_id = ${randomUUID()} WHERE id = ${id}`,
    (tx: postgres.TransactionSql) => tx`UPDATE package_sale_requests SET package_type_id = ${randomUUID()} WHERE id = ${id}`,
    (tx: postgres.TransactionSql) => tx`UPDATE package_sale_requests SET expected_type_revision = 5 WHERE id = ${id}`,
  ]) {
    await expect(asApp(query)).rejects.toMatchObject({ code: '42501' });
  }
});
