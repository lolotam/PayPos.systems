import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';

interface ForeignKeyRow {
  name: string;
  parent: string;
  columns: string[];
}

interface IndexRow {
  name: string;
  columns: string[];
  nkeys: number;
  ncols: number;
  method: string;
  valid: boolean;
  ready: boolean;
  predicate: string | null;
}

const EXPECTED_FOREIGN_KEYS = [
  { name: 'package_sale_requests_company_id_companies_id_fk', columns: ['company_id'] },
  { name: 'package_sale_requests_business_fk', columns: ['company_id', 'business_id'] },
  {
    name: 'package_sale_requests_branch_fk',
    columns: ['company_id', 'business_id', 'branch_id'],
  },
  { name: 'package_sale_requests_recorder_fk', columns: ['recorded_by'] },
  {
    name: 'package_sale_requests_recorder_membership_fk',
    columns: ['company_id', 'recorded_by', 'recorded_by_membership_id'],
  },
  {
    name: 'package_sale_requests_entitlement_fk',
    columns: ['company_id', 'entitlement_id'],
  },
];

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;

const SECOND_BUSINESS = randomUUID();
const SECOND_BRANCH = randomUUID();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  app = postgres(testDb.appUrl, { max: 2, onnotice: () => undefined });

  // Add a second business and branch to Tenant A to verify same-company cross-business branch refusal
  await owner`INSERT INTO businesses(id, company_id, vertical_type, name_en)
    VALUES (${SECOND_BUSINESS}, ${TENANT.A.company}, 'salon', 'Second Business A')`;
  await owner`INSERT INTO branches(id, company_id, business_id, name_en)
    VALUES (${SECOND_BRANCH}, ${TENANT.A.company}, ${SECOND_BUSINESS}, 'Second Branch A')`;
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await testDb?.drop();
});

type Tenant = { company: string; business: string; branch: string };

async function asApp<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
  tenant: Tenant = TENANT.A,
) {
  return app.begin(async (tx) => {
    await tx`SELECT set_config('app.company_id', ${tenant.company}, true), set_config('app.user_id', ${USER}, true)`;
    return work(tx);
  });
}

const foreignKeys = (table: string) =>
  owner<ForeignKeyRow[]>`
    SELECT c.conname AS name, c.confrelid::regclass::text AS parent,
      ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
            ORDER BY k.ord) AS columns
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.conrelid = ${table}::regclass
    ORDER BY c.conname`;

const indexes = (table: string) =>
  owner<IndexRow[]>`
    SELECT i.indexrelid::regclass::text AS name,
      ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
            WHERE k.ord <= i.indnkeyatts ORDER BY k.ord) AS columns,
      i.indnkeyatts AS nkeys, i.indnatts AS ncols, am.amname AS method,
      i.indisvalid AS valid, i.indisready AS ready,
      pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am am ON am.oid = c.relam
    WHERE i.indrelid = ${table}::regclass
    ORDER BY i.indexrelid::regclass::text`;

const nullableColumns = async (table: string): Promise<Set<string>> => {
  const rows = await owner<{ attname: string }[]>`
    SELECT attname FROM pg_attribute
    WHERE attrelid = ${table}::regclass AND attnum > 0 AND NOT attnotnull`;
  return new Set(rows.map((row) => row.attname));
};

const supports = (index: IndexRow, columns: string[], nullable: Set<string>): boolean => {
  if (index.method !== 'btree' || !index.valid || !index.ready) return false;
  if (index.columns.length < columns.length) return false;
  if (!columns.every((column, position) => index.columns[position] === column)) return false;
  if (index.predicate === null) return true;
  const match = /^\(([a-z_]+) IS NOT NULL\)$/.exec(index.predicate);
  const column = match?.[1];
  if (column === undefined) return false;
  return columns.includes(column) && nullable.has(column);
};

it('a branch of another business and a recorder of another company are refused', async () => {
  // Branch of another business (within Tenant A)
  await expect(
    asApp((tx) =>
      tx`INSERT INTO package_sale_requests (
        company_id, id, business_id, branch_id, recorded_by, recorded_by_membership_id,
        customer_id, package_type_id, expected_type_revision, expected_service_revisions,
        price_paid, paid_method, seller_employee_id, recorded_at, status
      ) VALUES (
        ${TENANT.A.company}, ${randomUUID()}, ${TENANT.A.business}, ${SECOND_BRANCH}, ${USER}, ${ORDER_IDS.membership},
        ${ORDER_IDS.customer}, ${randomUUID()}, 1,
        ${tx.json([{ service_id: ORDER_IDS.service, revision: 1, list_price: '1.000' }])},
        25.000, 'CASH', ${ORDER_IDS.employee}, now(), 'pending'
      )`,
    ),
  ).rejects.toMatchObject({ code: '23503', constraint_name: 'package_sale_requests_branch_fk' });

  // Branch of another company (Tenant B branch)
  await expect(
    asApp((tx) =>
      tx`INSERT INTO package_sale_requests (
        company_id, id, business_id, branch_id, recorded_by, recorded_by_membership_id,
        customer_id, package_type_id, expected_type_revision, expected_service_revisions,
        price_paid, paid_method, seller_employee_id, recorded_at, status
      ) VALUES (
        ${TENANT.A.company}, ${randomUUID()}, ${TENANT.A.business}, ${TENANT.B.branch}, ${USER}, ${ORDER_IDS.membership},
        ${ORDER_IDS.customer}, ${randomUUID()}, 1,
        ${tx.json([{ service_id: ORDER_IDS.service, revision: 1, list_price: '1.000' }])},
        25.000, 'CASH', ${ORDER_IDS.employee}, now(), 'pending'
      )`,
    ),
  ).rejects.toMatchObject({ code: '23503', constraint_name: 'package_sale_requests_branch_fk' });

  // Recorder membership not belonging to company A
  await expect(
    asApp((tx) =>
      tx`INSERT INTO package_sale_requests (
        company_id, id, business_id, branch_id, recorded_by, recorded_by_membership_id,
        customer_id, package_type_id, expected_type_revision, expected_service_revisions,
        price_paid, paid_method, seller_employee_id, recorded_at, status
      ) VALUES (
        ${TENANT.A.company}, ${randomUUID()}, ${TENANT.A.business}, ${TENANT.A.branch}, ${USER}, ${randomUUID()},
        ${ORDER_IDS.customer}, ${randomUUID()}, 1,
        ${tx.json([{ service_id: ORDER_IDS.service, revision: 1, list_price: '1.000' }])},
        25.000, 'CASH', ${ORDER_IDS.employee}, now(), 'pending'
      )`,
    ),
  ).rejects.toMatchObject({ code: '23503', constraint_name: 'package_sale_requests_recorder_membership_fk' });

  // Recorder user not existing in identity
  await expect(
    asApp((tx) =>
      tx`INSERT INTO package_sale_requests (
        company_id, id, business_id, branch_id, recorded_by, recorded_by_membership_id,
        customer_id, package_type_id, expected_type_revision, expected_service_revisions,
        price_paid, paid_method, seller_employee_id, recorded_at, status
      ) VALUES (
        ${TENANT.A.company}, ${randomUUID()}, ${TENANT.A.business}, ${TENANT.A.branch}, ${randomUUID()}, ${ORDER_IDS.membership},
        ${ORDER_IDS.customer}, ${randomUUID()}, 1,
        ${tx.json([{ service_id: ORDER_IDS.service, revision: 1, list_price: '1.000' }])},
        25.000, 'CASH', ${ORDER_IDS.employee}, now(), 'pending'
      )`,
    ),
  ).rejects.toMatchObject({ code: '23503' });
});

it('an unknown customer, type or seller id is accepted', async () => {
  const unknownCustomerId = randomUUID();
  const unknownPackageTypeId = randomUUID();
  const unknownSellerEmployeeId = randomUUID();
  const requestId = randomUUID();

  const inserted = await asApp((tx) =>
    tx`INSERT INTO package_sale_requests (
      company_id, id, business_id, branch_id, recorded_by, recorded_by_membership_id,
      discount_limit_bps, customer_id, package_type_id, expected_type_revision,
      expected_service_revisions, price_paid, paid_method, seller_employee_id,
      sold_at, recorded_at, status
    ) VALUES (
      ${TENANT.A.company}, ${requestId}, ${TENANT.A.business}, ${TENANT.A.branch}, ${USER}, ${ORDER_IDS.membership},
      null, ${unknownCustomerId}, ${unknownPackageTypeId}, 1,
      ${tx.json([{ service_id: ORDER_IDS.service, revision: 1, list_price: '1.000' }])},
      30.000, 'CARD', ${unknownSellerEmployeeId},
      null, now(), 'pending'
    ) RETURNING id`,
  );

  expect(inserted).toEqual([{ id: requestId }]);
});

it('package_sale_requests carries expected foreign keys', async () => {
  const found = await foreignKeys('package_sale_requests');
  const sortedFound = found
    .map((fk) => ({ name: fk.name, columns: fk.columns }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sortedExpected = [...EXPECTED_FOREIGN_KEYS].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  expect(sortedFound).toEqual(sortedExpected);
});

it('every foreign key of package_sale_requests has a supporting index', async () => {
  const nullable = await nullableColumns('package_sale_requests');
  const candidates = await indexes('package_sale_requests');
  for (const fk of await foreignKeys('package_sale_requests')) {
    const supporting = candidates.filter((index) => supports(index, fk.columns, nullable));
    expect(supporting.length, `package_sale_requests.${fk.name}`).toBeGreaterThan(0);
  }
});

it('creator status read and recovery sweep indexes are present and valid', async () => {
  const candidateIndexes = await indexes('package_sale_requests');
  const creatorIdx = candidateIndexes.find(
    (i) => i.columns[0] === 'company_id' && i.columns[1] === 'recorded_by' && i.columns[2] === 'id',
  );
  expect(creatorIdx?.valid).toBe(true);

  const sweepIdx = candidateIndexes.find(
    (i) => i.columns[0] === 'company_id' && i.columns[1] === 'status' && i.columns[2] === 'recorded_at',
  );
  expect(sweepIdx?.valid).toBe(true);
});
