import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  refundFixture,
  REFUND_TENANT,
  REFUND_USER,
  type RefundFixture,
} from '../../test/package-refund-fixture.ts';

const { A, B } = REFUND_TENANT;

let f: RefundFixture;
let seeded: { entitlement: string; component: string; refund: string; slot: string };
const noticeId = '01920000-0000-7000-8000-00000000ff01';

beforeAll(async () => {
  f = await refundFixture();
  seeded = await f.seedRefund();
});

afterAll(async () => {
  await f?.close();
});

const asTenant = (company: string, query: ReturnType<typeof sql>) =>
  f.db.withTenant(company, (tx) => tx.execute(query), { userId: REFUND_USER });

const insertNotice = (
  company: string,
  business: string,
  refund: string,
  id = noticeId,
  count = 0,
) => sql`INSERT INTO package_refund_notices
  (company_id,id,business_id,refund_id,source_event_id,decided_at,recipient_count)
  VALUES (${company},${id},${business},${refund},${f.nextId()},clock_timestamp(),${count})`;

async function rejected(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const failure = error as {
    code?: string;
    constraint_name?: string;
    cause?: { code?: string; constraint_name?: string };
  };
  expect(failure?.code ?? failure?.cause?.code).toBe(code);
  if (constraint !== undefined)
    expect(failure?.constraint_name ?? failure?.cause?.constraint_name).toBe(constraint);
}

it('forces row-level security and splits the policies', async () => {
  const [row] =
    await f.owner`SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner
      FROM pg_class WHERE oid='package_refund_notices'::regclass`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(row?.['owner']).not.toBe('pospay_app');
  const policies = await f.owner<
    { policyname: string; cmd: string; qual: string | null; with_check: string | null }[]
  >`SELECT policyname, cmd, qual, with_check FROM pg_policies
    WHERE tablename='package_refund_notices' ORDER BY policyname`;
  expect(policies).toMatchObject([
    {
      policyname: 'package_refund_notices_insert',
      cmd: 'INSERT',
      with_check: expect.stringContaining('app_company_id()'),
    },
    {
      policyname: 'package_refund_notices_select',
      cmd: 'SELECT',
      qual: expect.stringContaining('app_company_id()'),
    },
  ]);
  const [role] =
    await f.owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
});

it('refuses updating, deleting and truncating a notice row for the app role', async () => {
  for (const query of [
    sql`UPDATE package_refund_notices SET recipient_count=1`,
    sql`DELETE FROM package_refund_notices`,
    sql`TRUNCATE package_refund_notices`,
  ])
    await rejected(asTenant(A.company, query), '42501');
});

it('keeps tenant A notices invisible to tenant B and to no context', async () => {
  await asTenant(A.company, insertNotice(A.company, A.business, seeded.refund));
  expect(
    Array.from(
      await asTenant(
        B.company,
        sql`SELECT company_id FROM package_refund_notices WHERE company_id=${A.company}`,
      ),
    ),
  ).toEqual([]);
  const app = postgres(f.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await app.unsafe('SELECT company_id FROM package_refund_notices')).toEqual([]);
  } finally {
    await app.end();
  }
});

it('refuses tenant B inserting a notice with the company of tenant A', async () => {
  await rejected(
    asTenant(B.company, insertNotice(A.company, A.business, seeded.refund, f.nextId())),
    '42501',
  );
});

it('refuses a notice whose refund is not in the same company', async () => {
  await rejected(
    asTenant(A.company, insertNotice(A.company, A.business, f.nextId(), f.nextId())),
    '23503',
    'package_refund_notices_refund_fk',
  );
});

it('refuses a negative recipient count and a second notice for one refund', async () => {
  await rejected(
    asTenant(A.company, insertNotice(A.company, A.business, seeded.refund, f.nextId(), -1)),
    '23514',
    'package_refund_notices_recipient_count',
  );
  await rejected(
    asTenant(A.company, insertNotice(A.company, A.business, seeded.refund, f.nextId())),
    '23505',
  );
});

it('records one durable notice row for the refund and keeps it readable by its own company', async () => {
  const rows = await asTenant(
    A.company,
    sql`SELECT company_id,id,business_id,refund_id,recipient_count FROM package_refund_notices
      WHERE refund_id=${seeded.refund}`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    company_id: A.company,
    id: noticeId,
    business_id: A.business,
    refund_id: seeded.refund,
    recipient_count: 0,
  });
});
