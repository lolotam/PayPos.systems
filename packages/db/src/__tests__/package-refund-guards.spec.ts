import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  refundFixture,
  rejected,
  REFUND_TENANT,
  type RefundFixture,
  type RefundOptions,
  type RefundSale,
} from '../../test/package-refund-fixture.ts';

const COMPANY = REFUND_TENANT.A.company;

let f: RefundFixture;

beforeAll(async () => {
  f = await refundFixture();
});

afterAll(async () => {
  await f?.close();
});

/** جلسة بالترتيب من البيع؛ الفهرس جاي من الاختبار نفسه فمفيش قيمة ناقصة. */
function at(sale: RefundSale, index: number) {
  const slot = sale.slots[index];
  if (slot === undefined) throw new Error('Expected a session');
  return slot;
}

it('commits a refund of two sessions and moves the refunded amount and the revision by one step', async () => {
  const sale = await f.sell(2);
  await f.writeRefund(sale, { sessions: 2, amount: '2.000', rows: [{ index: 0 }, { index: 1 }] });
  expect(
    await f.owner`SELECT refunded_amount::text AS refunded_amount, revision FROM package_entitlements
      WHERE id=${sale.entitlement}`,
  ).toEqual([{ refunded_amount: '2.000', revision: 2 }]);
  expect(
    await f.owner`SELECT state FROM package_session_slots WHERE entitlement_id=${sale.entitlement} ORDER BY ordinal`,
  ).toEqual([{ state: 'REFUNDED' }, { state: 'REFUNDED' }]);
  expect(
    await f.owner`SELECT count(*)::int AS refunds FROM package_refunds WHERE entitlement_id=${sale.entitlement}`,
  ).toEqual([{ refunds: 1 }]);
  expect(
    await f.owner`SELECT count(*)::int AS sessions FROM package_refund_slots WHERE refund_id IN
      (SELECT id FROM package_refunds WHERE entitlement_id=${sale.entitlement})`,
  ).toEqual([{ sessions: 2 }]);
});

it('refuses a refund row without its session rows at commit', async () => {
  const sale = await f.sell(2);
  await rejected(
    f.writeRefund(sale, { sessions: 2, amount: '2.000' }),
    '23514',
    'package_refunds_integrity',
  );
});

it('refuses a refund session row without its refund row', async () => {
  const sale = await f.sell(1);
  await rejected(
    f.db.withTenant(COMPANY, (tx) =>
      tx.execute(sql`INSERT INTO package_refund_slots
        (company_id,id,business_id,refund_id,entitlement_id,component_id,slot_id,ordinal,unit_value)
        VALUES (${COMPANY}::uuid,${f.nextId()}::uuid,${REFUND_TENANT.A.business}::uuid,
          ${f.nextId()}::uuid,${sale.entitlement}::uuid,${sale.component}::uuid,
          ${at(sale, 0).id}::uuid,1,'1.000')`),
    ),
    '23503',
    'package_refund_slots_refund_fk',
  );
});

const brokenRefunds: [string, RefundOptions][] = [
  [
    'a refund session that copies another session value',
    { sessions: 2, amount: '2.500', rows: [{ index: 0 }, { index: 1, unitValue: '1.500' }] },
  ],
  [
    'a refund session that copies another session ordinal',
    { sessions: 2, amount: '2.000', rows: [{ index: 0 }, { index: 1, ordinal: 3 }] },
  ],
  [
    'a refund that claims more sessions than its own rows',
    { sessions: 3, amount: '2.000', rows: [{ index: 0 }, { index: 1 }] },
  ],
  [
    'a refund whose amount is not the sum of its sessions',
    { sessions: 2, amount: '2.500', rows: [{ index: 0 }, { index: 1 }] },
  ],
  [
    'a refunded amount that moved by another amount',
    { sessions: 2, amount: '2.000', refundedAmount: '2.500', rows: [{ index: 0 }, { index: 1 }] },
  ],
  [
    'a refund whose entitlement revision is not the revision of its entitlement',
    { sessions: 2, amount: '2.000', entitlementRevision: 3, rows: [{ index: 0 }, { index: 1 }] },
  ],
];

it.each(brokenRefunds)('refuses %s at commit', async (_name, options) => {
  await rejected(f.writeRefund(await f.sell(3), options), '23514', 'package_refunds_integrity');
});

const revisionSteps: [string, (id: string) => SQL][] = [
  [
    'a revision that moves by two steps',
    (id) => sql`UPDATE package_entitlements SET revision=3 WHERE id=${id}`,
  ],
  [
    'a refunded amount changed with no revision change',
    (id) => sql`UPDATE package_entitlements SET refunded_amount='1.000' WHERE id=${id}`,
  ],
  [
    'a revision that decreases',
    (id) => sql`UPDATE package_entitlements SET revision=0 WHERE id=${id}`,
  ],
];

it.each(revisionSteps)('refuses %s immediately', async (_name, statement) => {
  const sale = await f.sell(1);
  await rejected(
    f.db.withTenant(COMPANY, (tx) => tx.execute(statement(sale.entitlement))),
    '23514',
    'package_entitlements_revision_step',
  );
});

const refundedBounds: [string, (id: string) => SQL][] = [
  [
    'a refunded amount that decreases',
    (id) => sql`UPDATE package_entitlements SET refunded_amount='0.500',revision=3 WHERE id=${id}`,
  ],
  [
    'a refunded amount above the price paid',
    (id) => sql`UPDATE package_entitlements SET refunded_amount='2.000',revision=2 WHERE id=${id}`,
  ],
];

it.each(refundedBounds)('refuses %s immediately', async (_name, statement) => {
  const sale = await f.sell(1);
  await f.writeRefund(sale, { sessions: 1, amount: '1.000', rows: [{ index: 0 }] });
  await rejected(
    f.db.withTenant(COMPANY, (tx) => tx.execute(statement(sale.entitlement))),
    '23514',
    'package_entitlements_refunded_amount_bounds',
  );
});

it('does not let the application update or delete a refund row', async () => {
  await rejected(
    f.db.withTenant(COMPANY, (tx) => tx.execute(sql`UPDATE package_refunds SET reason='Changed'`)),
    '42501',
  );
  await rejected(
    f.db.withTenant(COMPANY, (tx) => tx.execute(sql`DELETE FROM package_refunds`)),
    '42501',
  );
  await rejected(
    f.db.withTenant(COMPANY, (tx) => tx.execute(sql`UPDATE package_refund_slots SET ordinal=9`)),
    '42501',
  );
  await rejected(
    f.db.withTenant(COMPANY, (tx) => tx.execute(sql`DELETE FROM package_refund_slots`)),
    '42501',
  );
});
