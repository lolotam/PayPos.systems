import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  refundFixture,
  REFUND_MEMBERSHIP,
  REFUND_TENANT,
  REFUND_USER,
  type RefundFixture,
} from '../../test/package-refund-fixture.ts';

const { A, B } = REFUND_TENANT;

let f: RefundFixture;
let seeded: { entitlement: string; component: string; refund: string; slot: string };

beforeAll(async () => {
  f = await refundFixture();
  seeded = await f.seedRefund();
});

afterAll(async () => {
  await f?.close();
});

const asTenant = (company: string, query: ReturnType<typeof sql>) =>
  f.db.withTenant(company, (tx) => tx.execute(query), { userId: REFUND_USER });

it('forces row-level security on both refund tables', async () => {
  expect(
    await f.owner`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE relname IN ('package_refunds','package_refund_slots') ORDER BY relname`,
  ).toEqual([
    { relname: 'package_refund_slots', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'package_refunds', relrowsecurity: true, relforcerowsecurity: true },
  ]);
});

it('hides tenant A refund rows from tenant B and from no context', async () => {
  expect(
    Array.from(
      await asTenant(B.company, sql`SELECT company_id FROM package_refunds WHERE company_id=${A.company}`),
    ),
  ).toEqual([]);
  expect(
    Array.from(
      await asTenant(
        B.company,
        sql`SELECT company_id FROM package_refund_slots WHERE company_id=${A.company}`,
      ),
    ),
  ).toEqual([]);
  const app = postgres(f.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await app.unsafe('SELECT company_id FROM package_refunds')).toEqual([]);
    expect(await app.unsafe('SELECT company_id FROM package_refund_slots')).toEqual([]);
  } finally {
    await app.end();
  }
});

it('refuses tenant B inserting a refund row with the company of tenant A', async () => {
  const error = await asTenant(
    B.company,
    sql`INSERT INTO package_refunds
      (company_id,id,business_id,entitlement_id,component_id,branch_id,sessions,amount,method,reason,
        refunded_by,refunded_by_membership_id,refunded_at,entitlement_revision)
      VALUES (${A.company},${f.nextId()},${A.business},${seeded.entitlement},${seeded.component},
        ${A.branch},1,'1.000','CASH','Synthetic refund',${REFUND_USER},${REFUND_MEMBERSHIP},now(),2)`,
  ).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const failure = error as { code?: string; cause?: { code?: string } };
  expect(failure?.code ?? failure?.cause?.code).toBe('42501');
});

it('refuses tenant B inserting a refund slot row with the company of tenant A', async () => {
  const error = await asTenant(
    B.company,
    sql`INSERT INTO package_refund_slots
      (company_id,id,business_id,refund_id,entitlement_id,component_id,slot_id,ordinal,unit_value)
      VALUES (${A.company},${f.nextId()},${A.business},${seeded.refund},${seeded.entitlement},
        ${seeded.component},${seeded.slot},1,'1.000')`,
  ).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const failure = error as { code?: string; cause?: { code?: string } };
  expect(failure?.code ?? failure?.cause?.code).toBe('42501');
});
