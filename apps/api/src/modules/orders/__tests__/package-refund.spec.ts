import { packageRefundResponse, packageSaleChanged } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids, must, type SessionFixture } from './session.fixture.ts';
import {
  EXPIRED_EXPIRY,
  packageRefundFixture,
  postRefund,
  readRefundAudits,
  readRefunds,
  readRefundSlots,
  readSaleEvents,
  refundBody,
  seedSoldPackage,
  type PackageRefundFixture,
} from './package-refund.fixture.ts';

let fx: PackageRefundFixture;

beforeAll(async () => {
  fx = await packageRefundFixture();
});

afterAll(async () => {
  await fx?.f.close();
});

/** سطر الاسترداد في القاعدة: صف واحد بثماني جلسات ومبلغ 18.000 ومن نفّذه. */
async function expectRefundRow(
  f: SessionFixture,
  entitlementId: string,
  componentId: string,
  refundId: string,
  reason: string,
): Promise<void> {
  const refunds = await readRefunds(f, entitlementId);
  expect(refunds).toHaveLength(1);
  expect(refunds[0]).toMatchObject({
    id: refundId,
    component_id: componentId,
    sessions: 8,
    amount: '18.000',
    method: 'CASH',
    reason: reason.trim(),
    entitlement_revision: 2,
    refunded_by: f.userId,
    refunded_by_membership_id: f.membership,
    branch_id: f.branch,
  });
}

/** سجل التدقيق: تحديث الاستحقاق بخطوتين، والسبب مش جوّاه. */
async function expectRefundAudit(
  f: SessionFixture,
  entitlementId: string,
  refundId: string,
  reason: string,
): Promise<void> {
  const audits = await readRefundAudits(f, entitlementId);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    action: 'package.refunded',
    entity: 'package_entitlement',
    actor_user_id: f.userId,
    before: { refunded_amount: '0.000', revision: 1 },
    after: { refunded_amount: '18.000', revision: 2, refund_id: refundId },
  });
  expect(JSON.stringify(audits[0])).not.toContain(reason.trim());
}

/** حدث البيع: payload واحد مطابق بالكامل، والسبب مش جوّاه. */
async function expectSaleChangedEvent(
  f: SessionFixture,
  entitlementId: string,
  reason: string,
): Promise<void> {
  const events = await readSaleEvents(f, entitlementId);
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events[0]?.['payload'])).not.toContain(reason.trim());
  expect(packageSaleChanged.parse(events[0]?.['payload'])).toEqual({
    sale_id: entitlementId,
    business_id: f.business,
    branch_id: f.branch,
    sold_at: '2026-10-01T08:00:00.000Z',
    business_date: '2026-10-20',
    seller_employee_id: must(f.employees[0]),
    price_paid: '22.500',
    refunded_amount: '18.000',
    status: 'SOLD',
    revision: 2,
    schema_version: 1,
  });
}

it('RF-01 refunds the highest free sessions and records the refund, the audit and one sale event', async () => {
  const { f, sold } = fx;
  const key = ids.newId();
  const reason = '  Customer asked for a refund  ';
  const response = await postRefund(f, sold.entitlement, {
    key,
    body: refundBody({ component_id: sold.component, sessions: 8, reason }),
  });
  expect(response.status).toBe(201);
  const body = packageRefundResponse.parse(response.body);
  expect(body).toMatchObject({
    entitlement_id: sold.entitlement,
    component_id: sold.component,
    sessions: 8,
    amount: '18.000',
    method: 'CASH',
    refunded_amount: '18.000',
    revision: 2,
    refunded_at: '2026-10-15T08:00:00.000Z',
  });
  await expectRefundRow(f, sold.entitlement, sold.component, body.id, reason);
  const slots = await readRefundSlots(f, sold.entitlement);
  expect(slots.map((row) => row['ordinal'])).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  expect(slots.map((row) => row['state'])).toEqual(Array(8).fill('REFUNDED'));
  expect(
    await f.h.owner`SELECT refunded_amount::text AS refunded_amount, revision FROM package_entitlements
      WHERE id=${sold.entitlement}`,
  ).toEqual([{ refunded_amount: '18.000', revision: 2 }]);
  await expectRefundAudit(f, sold.entitlement, body.id, reason);
  await expectSaleChangedEvent(f, sold.entitlement, reason);
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE key=${key}`;
  expect(stored?.['body']).not.toContain(reason.trim());
  // جرس الاسترداد (PackageRefundRecorded) مع 46-3؛ الشريحة دي بتطلع SoldChanged بس.
});

it('RF-01 refunds the highest five free ordinals when five sessions are asked for', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f);
  const response = await postRefund(f, fresh.entitlement, {
    body: refundBody({ component_id: fresh.component, sessions: 5 }),
  });
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    amount: '11.250',
    refunded_amount: '11.250',
    revision: 2,
  });
  const slots = await readRefundSlots(f, fresh.entitlement);
  // أعلى خمس جلسات حرة: 10..6 (الترتيب هنا تصاعدي من القراءة).
  expect(slots.map((row) => row['ordinal'])).toEqual([6, 7, 8, 9, 10]);
});

it('RF-02 refuses more sessions than the package has free and writes nothing', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f, { sessions: 2 });
  const response = await postRefund(f, fresh.entitlement, {
    body: refundBody({ component_id: fresh.component, sessions: 3 }),
  });
  expect(response).toMatchObject({ status: 422, body: { code: 'INSUFFICIENT_SLOTS' } });
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(0);
  expect(await readRefundAudits(f, fresh.entitlement)).toHaveLength(0);
  expect(await readSaleEvents(f, fresh.entitlement)).toHaveLength(0);
  expect(
    await f.h.owner`SELECT refunded_amount::text AS refunded_amount, revision FROM package_entitlements
      WHERE id=${fresh.entitlement}`,
  ).toEqual([{ refunded_amount: '0.000', revision: 1 }]);
});

it('RF-05 replays the same refund and refuses the same key with another body', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f);
  const key = ids.newId();
  const body = refundBody({ component_id: fresh.component, sessions: 2 });
  const first = await postRefund(f, fresh.entitlement, { key, body });
  const replay = await postRefund(f, fresh.entitlement, { key, body });
  expect(first.status).toBe(201);
  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(1);
  expect(await readRefundAudits(f, fresh.entitlement)).toHaveLength(1);
  expect(await readSaleEvents(f, fresh.entitlement)).toHaveLength(1);
  expect(
    await postRefund(f, fresh.entitlement, {
      key,
      body: refundBody({ component_id: fresh.component, sessions: 3 }),
    }),
  ).toMatchObject({ status: 422, body: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(1);
});

it('RF-06 refuses a package past its expiry day', async () => {
  const { f } = fx;
  const expired = await seedSoldPackage(f, { expiresOn: EXPIRED_EXPIRY });
  const response = await postRefund(f, expired.entitlement, {
    body: refundBody({ component_id: expired.component, sessions: 1 }),
  });
  expect(response).toMatchObject({ status: 422, body: { code: 'PACKAGE_EXPIRED' } });
  expect(await readRefunds(f, expired.entitlement)).toHaveLength(0);
  expect(await readRefundAudits(f, expired.entitlement)).toHaveLength(0);
});

it.each([0, -1, 1.5])('RF-07 refuses a session count of %s at the contract', async (sessions) => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f);
  const response = await postRefund(f, fresh.entitlement, {
    body: refundBody({ component_id: fresh.component, sessions }),
  });
  expect(response).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(0);
});

it('RF-07 refuses a component that belongs to another entitlement', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f);
  const other = await seedSoldPackage(f);
  const response = await postRefund(f, fresh.entitlement, {
    body: refundBody({ component_id: other.component, sessions: 1 }),
  });
  expect(response).toMatchObject({ status: 422, body: { code: 'PACKAGE_COMPONENT_NOT_FOUND' } });
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(0);
  expect(await readRefundSlots(f, fresh.entitlement)).toHaveLength(0);
});

it.each([
  ['an empty reason', ''],
  ['a whitespace-only reason', ' \t\r\n '],
  ['a reason of 501 characters', 'x'.repeat(501)],
])('refuses %s with the refund reason code and writes nothing', async (_name, reason) => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f);
  const response = await postRefund(f, fresh.entitlement, {
    body: refundBody({ component_id: fresh.component, sessions: 1, reason }),
  });
  expect(response).toMatchObject({ status: 422, body: { code: 'PACKAGE_REFUND_REASON_INVALID' } });
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(0);
  expect(await readRefundAudits(f, fresh.entitlement)).toHaveLength(0);
  expect(await readSaleEvents(f, fresh.entitlement)).toHaveLength(0);
});

it('feature switched off with an invalid reason answers 403 FEATURE_DISABLED and writes nothing', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic refund feature',${f.ownerId})`;
  try {
    const response = await postRefund(f, fresh.entitlement, {
      body: refundBody({ component_id: fresh.component, sessions: 1, reason: '   ' }),
    });
    expect(response).toMatchObject({ status: 403, body: { code: 'FEATURE_DISABLED' } });
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(0);
  expect(
    await f.h.owner`SELECT id FROM outbox WHERE company_id=${f.company} AND aggregate_id=${fresh.entitlement}`,
  ).toHaveLength(0);
});
