import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  customerImportCommitStaleBefore,
  CUSTOMER_IMPORT_STALE_MS,
} from '../domain/customer-import-commit.ts';
import { customerImportCommitTransactions } from '../persistence/customer-import-commit.transactions.ts';
import {
  CommitCustomerImport,
  RecoverCustomerImports,
} from '../use-cases/commit-customer-import/commit-customer-import.ts';

const PHONE = '+96598765432';
const MASKED = '***432';
const FILE_ID = '01920000-0000-7000-8000-0000000000f2';

let owner: postgres.Sql;
let db: ReturnType<typeof createDatabase>;
let commit: CommitCustomerImport;
let recovery: RecoverCustomerImports;

beforeAll(async () => {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const ids = systemUuidV7();
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO "user"(id,name,email) VALUES(${USER},'Synthetic importer','worker-import@example.test') ON CONFLICT(id) DO NOTHING`;
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,
    content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES(${TENANT.A.company},${FILE_ID},${TENANT.A.business},'customers',${TENANT.A.business},${`staging/${FILE_ID}`},${`verified/${FILE_ID}`},
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,'create:customers:business',${USER},now(),'READY')
    ON CONFLICT (company_id, id) DO NOTHING`;
  const transactions = customerImportCommitTransactions(db, ids);
  commit = new CommitCustomerImport(transactions, { now: () => new Date('2026-11-26T10:00:00Z') });
  recovery = new RecoverCustomerImports(transactions, {
    now: () => new Date('2026-11-26T10:00:00Z'),
  });
});

beforeEach(async () => {
  await owner`DELETE FROM customer_notes WHERE company_id=${TENANT.A.company}`;
  await owner`DELETE FROM customers WHERE company_id=${TENANT.A.company}`;
  await owner`DELETE FROM import_previews WHERE company_id=${TENANT.A.company}`;
  await owner`DELETE FROM audit_log WHERE company_id=${TENANT.A.company}`;
});

afterAll(async () => {
  await owner?.end();
});

async function seedPreview(
  rows: readonly Record<string, unknown>[],
  options: { errorCount?: number; requestedAt?: string } = {},
) {
  const previewId = systemUuidV7().newId();
  await owner`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,requested_at,status,row_count,error_count,rows,errors)
    VALUES(${TENANT.A.company},${previewId},${TENANT.A.business},'customers',${FILE_ID},${USER},now(),
      now() + interval '1 day',${options.requestedAt ?? '2026-11-26T09:59:00Z'},'commit_requested',${rows.length},
      ${options.errorCount ?? 0},${owner.json(rows as unknown as Parameters<typeof owner.json>[0])},${owner.json([] as unknown as Parameters<typeof owner.json>[0])})`;
  return previewId;
}

const cleanRow = (overrides: Record<string, unknown> = {}) => ({
  row: 2,
  name: 'أحمد',
  phone: PHONE,
  masked_phone: MASKED,
  locale: 'ar',
  no_rating: false,
  birthday: null,
  gender: 'male',
  email: null,
  note: null,
  status: 'new',
  warning: null,
  ...overrides,
});

const customerRows = () =>
  owner`SELECT id,name,phone,locale,opted_out_at,birth_month,birth_day,birth_year,gender,email
    FROM customers WHERE company_id=${TENANT.A.company} ORDER BY created_at`;

it('commits a new customer with its note and a masked-phone audit in one transaction', async () => {
  const previewId = await seedPreview([cleanRow({ note: 'ملاحظة' })]);
  await commit.execute(TENANT.A.company, previewId);
  const rows = await customerRows();
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatchObject({ name: 'أحمد', phone: PHONE, locale: 'ar', gender: 'male' });
  const [note] = await owner`SELECT note FROM customer_notes WHERE company_id=${TENANT.A.company}`;
  expect(note?.['note']).toBe('ملاحظة');
  const [audit] =
    await owner`SELECT after FROM audit_log WHERE company_id=${TENANT.A.company} AND entity='customer' AND action='imported'`;
  const after = JSON.stringify(audit?.['after']);
  expect(after).toContain(MASKED);
  expect(after).not.toContain('98765432');
  const [preview] =
    await owner`SELECT status,created_count FROM import_previews WHERE id=${previewId}`;
  expect(preview).toMatchObject({ status: 'committed', created_count: 1 });
});

it('refuses a preview that still carries row errors and writes no customer', async () => {
  const previewId = await seedPreview([cleanRow()], { errorCount: 2 });
  await commit.execute(TENANT.A.company, previewId);
  const [preview] =
    await owner`SELECT status,error_code FROM import_previews WHERE id=${previewId}`;
  expect(preview).toMatchObject({ status: 'failed', error_code: 'IMPORT_PREVIEW_HAS_ERRORS' });
  expect(await customerRows()).toEqual([]);
});

it('rolls back earlier inserts in one transaction when a later new row lacks gender', async () => {
  const previewId = await seedPreview([
    cleanRow({ row: 2, phone: '+96598765432', masked_phone: '***432', gender: 'male' }),
    cleanRow({ row: 3, phone: '+96598765433', masked_phone: '***433', gender: null }),
  ]);
  await commit.execute(TENANT.A.company, previewId);
  const [preview] =
    await owner`SELECT status,error_code FROM import_previews WHERE id=${previewId}`;
  expect(preview).toMatchObject({ status: 'failed', error_code: 'IMPORT_COMMIT_FAILED' });
  expect(await customerRows()).toEqual([]);
});

it('fills only the empty profile of an existing customer and keeps its values', async () => {
  const existingId = systemUuidV7().newId();
  await owner`INSERT INTO customers(company_id,id,name,phone,locale,gender,birth_month,birth_day,created_at,updated_at)
    VALUES(${TENANT.A.company},${existingId},'سالم',${PHONE},'en','female',3,7,now(),now())`;
  const previewId = await seedPreview([
    cleanRow({
      gender: 'male',
      birthday: { day: 12, month: 8, year: 1995 },
      status: 'existing',
      email: 'a@b.co',
      note: 'ملاحظة',
    }),
  ]);
  await commit.execute(TENANT.A.company, previewId);
  const rows = await customerRows();
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatchObject({
    id: existingId,
    name: 'سالم',
    locale: 'en',
    gender: 'female',
    birth_month: 3,
    birth_day: 7,
    birth_year: null,
    email: 'a@b.co',
  });
  const [note] =
    await owner`SELECT note,business_id FROM customer_notes WHERE company_id=${TENANT.A.company}`;
  expect(note).toMatchObject({ note: 'ملاحظة', business_id: TENANT.A.business });
});

it('converts a CIM-05 phone race to an existing fill-empty without failing and leaves no-rating off', async () => {
  const racerId = systemUuidV7().newId();
  await owner`INSERT INTO customers(company_id,id,name,phone,locale,gender,created_at,updated_at)
    VALUES(${TENANT.A.company},${racerId},'نورة',${PHONE},'ar','female',now(),now())`;
  const previewId = await seedPreview([
    cleanRow({ gender: 'male', no_rating: true, email: 'race@b.co', status: 'new' }),
  ]);
  await commit.execute(TENANT.A.company, previewId);
  const rows = await customerRows();
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatchObject({
    id: racerId,
    name: 'نورة',
    gender: 'female',
    opted_out_at: null,
    email: 'race@b.co',
  });
  const [preview] =
    await owner`SELECT status,created_count FROM import_previews WHERE id=${previewId}`;
  expect(preview).toMatchObject({ status: 'committed', created_count: 0 });
});

it('fails a stale request through the recovery page', async () => {
  const previewId = await seedPreview([cleanRow()], { requestedAt: '2026-11-26T09:00:00Z' });
  await recovery.execute(TENANT.A.company);
  const [preview] =
    await owner`SELECT status,error_code FROM import_previews WHERE id=${previewId}`;
  expect(preview).toMatchObject({ status: 'failed', error_code: 'IMPORT_COMMIT_FAILED' });
});

it('puts the stale boundary five minutes before the injected instant', () => {
  expect(customerImportCommitStaleBefore(1_000_000)).toBe(1_000_000 - CUSTOMER_IMPORT_STALE_MS);
});

it('fails a preview that expired before its commit was requested and writes no customer', async () => {
  const previewId = await seedPreview([cleanRow()], { requestedAt: '2026-11-28T00:00:00Z' });
  await commit.execute(TENANT.A.company, previewId);
  const [preview] =
    await owner`SELECT status,error_code FROM import_previews WHERE id=${previewId}`;
  expect(preview).toMatchObject({ status: 'failed', error_code: 'IMPORT_PREVIEW_EXPIRED' });
  expect(await customerRows()).toEqual([]);
});

it('isolates a preview from another company during commit and recovery', async () => {
  const previewId = await seedPreview([cleanRow()], { requestedAt: '2026-11-26T09:00:00Z' });
  await commit.execute(TENANT.B.company, previewId);
  await recovery.execute(TENANT.B.company);
  const [preview] =
    await owner`SELECT status,error_code FROM import_previews WHERE id=${previewId}`;
  expect(preview).toMatchObject({ status: 'commit_requested', error_code: null });
  expect(await customerRows()).toEqual([]);
});
