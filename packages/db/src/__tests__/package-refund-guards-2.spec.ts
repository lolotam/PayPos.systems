import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  refundFixture,
  rejected,
  REFUND_CURRENT,
  REFUND_MEMBERSHIP,
  REFUND_NEXT,
  REFUND_TENANT,
  REFUND_USER,
  type RefundFixture,
  type RefundSale,
} from '../../test/package-refund-fixture.ts';

const COMPANY = REFUND_TENANT.A.company;
const BUSINESS = REFUND_TENANT.A.business;

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

it('refuses a free session refunded without its refund session row at commit', async () => {
  const sale = await f.sell(1);
  await rejected(
    f.db.withTenant(COMPANY, (tx) =>
      tx.execute(sql`UPDATE package_session_slots SET state='REFUNDED' WHERE id=${at(sale, 0).id}`),
    ),
    '23514',
    'package_refunds_slot_missing',
  );
});

const terminalStates: [string, 'refunded' | 'used' | 'imported', string][] = [
  ['REFUNDED -> FREE', 'refunded', 'FREE'],
  ['REFUNDED -> USED', 'refunded', 'USED'],
  ['USED -> REFUNDED', 'used', 'REFUNDED'],
  ['IMPORTED_USED -> REFUNDED', 'imported', 'REFUNDED'],
];

it.each(terminalStates)('refuses the terminal transition %s', async (_name, from, to) => {
  const sale = from === 'imported' ? await f.sellImported(2, 1) : await f.sell(2);
  if (from === 'refunded') {
    await f.writeRefund(sale, { sessions: 1, amount: '1.000', rows: [{ index: 0 }] });
  }
  if (from === 'used') {
    await f.redeemSlot(sale, 0);
  }
  await rejected(
    f.db.withTenant(COMPANY, (tx) =>
      tx.execute(sql`UPDATE package_session_slots SET state=${to} WHERE id=${at(sale, 0).id}`),
    ),
    '23514',
    'package_session_slots_state_closed',
  );
});

it('refuses a second refund of the same session', async () => {
  const sale = await f.sell(2);
  const { id } = await f.writeRefund(sale, { sessions: 1, amount: '1.000', rows: [{ index: 0 }] });
  await rejected(
    f.db.withTenant(COMPANY, (tx) =>
      tx.execute(sql`INSERT INTO package_refund_slots
        (company_id,id,business_id,refund_id,entitlement_id,component_id,slot_id,ordinal,unit_value)
        VALUES (${COMPANY}::uuid,${f.nextId()}::uuid,${BUSINESS}::uuid,${id}::uuid,
          ${sale.entitlement}::uuid,${sale.component}::uuid,${at(sale, 0).id}::uuid,1,'1.000')`),
    ),
    '23505',
    'package_refund_slots_slot_key',
  );
});

it.each([
  ['in a plain transaction', false],
  ['after the constraints are flushed and deferred again', true],
])('refuses a session added to a committed refund %s', async (_name, flush) => {
  const sale = await f.sell(2);
  const { id } = await f.writeRefund(sale, { sessions: 1, amount: '1.000', rows: [{ index: 0 }] });
  await rejected(
    f.db.withTenant(COMPANY, async (tx) => {
      if (flush) {
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
        await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
      }
      await tx.execute(sql`INSERT INTO package_refund_slots
        (company_id,id,business_id,refund_id,entitlement_id,component_id,slot_id,ordinal,unit_value)
        VALUES (${COMPANY}::uuid,${f.nextId()}::uuid,${BUSINESS}::uuid,${id}::uuid,
          ${sale.entitlement}::uuid,${sale.component}::uuid,${at(sale, 1).id}::uuid,2,'1.000')`);
    }),
    '23514',
    'package_refund_slots_over_sessions',
  );
});

it('commits two refunds of different sessions in one transaction with the revision two steps ahead', async () => {
  const sale = await f.sell(4);
  await f.db.withTenant(COMPANY, async (tx) => {
    await f.refundStatements(tx, sale, f.nextId(), {
      sessions: 1,
      amount: '1.000',
      entitlementRevision: 2,
      rows: [{ index: 0 }],
    });
    await f.refundStatements(tx, sale, f.nextId(), {
      sessions: 1,
      amount: '1.000',
      entitlementRevision: 3,
      rows: [{ index: 1 }],
    });
    await tx.execute(sql`UPDATE package_entitlements SET refunded_amount='1.000',revision=2
      WHERE id=${sale.entitlement}`);
    await tx.execute(sql`UPDATE package_entitlements SET refunded_amount='2.000',revision=3
      WHERE id=${sale.entitlement}`);
  });
  expect(
    await f.owner`SELECT refunded_amount::text AS refunded_amount, revision FROM package_entitlements
      WHERE id=${sale.entitlement}`,
  ).toEqual([{ refunded_amount: '2.000', revision: 3 }]);
  expect(
    await f.owner`SELECT count(*)::int AS refunds FROM package_refunds WHERE entitlement_id=${sale.entitlement}`,
  ).toEqual([{ refunds: 2 }]);
});

it('commits a zero-value refund with its own row and one more revision', async () => {
  const sale = await f.sell(2, '0.000');
  await f.writeRefund(sale, { sessions: 1, amount: '0.000', rows: [{ index: 0 }] });
  expect(
    await f.owner`SELECT amount::text AS amount, sessions FROM package_refunds
      WHERE entitlement_id=${sale.entitlement}`,
  ).toEqual([{ amount: '0.000', sessions: 1 }]);
  expect(
    await f.owner`SELECT refunded_amount::text AS refunded_amount, revision FROM package_entitlements
      WHERE id=${sale.entitlement}`,
  ).toEqual([{ refunded_amount: '0.000', revision: 2 }]);
});

it('still extends a package after the refund guards replaced the entitlement guard', async () => {
  const sale = await f.sell(1);
  await f.db.withTenant(COMPANY, async (tx) => {
    await tx.execute(sql`INSERT INTO package_extensions
      (company_id,id,business_id,entitlement_id,branch_id,previous_expires_on,new_expires_on,reason,
        extended_by,extended_by_membership_id,extended_at)
      VALUES (${COMPANY}::uuid,${f.nextId()}::uuid,${BUSINESS}::uuid,${sale.entitlement}::uuid,
        ${REFUND_TENANT.A.branch}::uuid,${REFUND_CURRENT},${REFUND_NEXT},'Synthetic extension',
        ${REFUND_USER}::uuid,${REFUND_MEMBERSHIP}::uuid,now())`);
    await tx.execute(sql`UPDATE package_entitlements SET expires_on=${REFUND_NEXT}
      WHERE id=${sale.entitlement}`);
  });
  expect(
    await f.owner`SELECT count(*)::int AS extensions FROM package_extensions
      WHERE entitlement_id=${sale.entitlement}`,
  ).toEqual([{ extensions: 1 }]);
});

it('still redeems a free session after the refund guards replaced the session guard', async () => {
  const sale = await f.sell(1);
  await f.redeemSlot(sale, 0);
  expect(await f.owner`SELECT state FROM package_session_slots WHERE id=${at(sale, 0).id}`).toEqual([
    { state: 'USED' },
  ]);
  expect(
    await f.owner`SELECT count(*)::int AS redemptions FROM package_redemptions
      WHERE entitlement_id=${sale.entitlement}`,
  ).toEqual([{ redemptions: 1 }]);
});

it('commits a refund of 365 sessions inside the 200 ms commit budget', async () => {
  const sale = await f.sell(365);
  const rows = sale.slots.map((_slot, index) => ({ index }));
  const { flushMs } = await f.writeRefund(sale, {
    sessions: 365,
    amount: '365.000',
    rows,
    flush: true,
  });
  expect(flushMs).toBeLessThan(200);
  expect(
    await f.owner`SELECT count(*)::int AS sessions FROM package_refund_slots WHERE refund_id IN
      (SELECT id FROM package_refunds WHERE entitlement_id=${sale.entitlement})`,
  ).toEqual([{ sessions: 365 }]);
});
