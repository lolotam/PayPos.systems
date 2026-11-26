import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { CustomerImportError } from '../domain/customer-import.ts';
import {
  cleanCustomerImportError,
  customerImportScopeReads,
} from '../persistence/drizzle-customer-import.ts';
import {
  CUSTOMER_IMPORT_SCOPE_READS,
  customerImportRowsPage,
  customerImportRowsPageStatement,
  customerImportStatusQuery,
  customerImportStatusStatement,
} from '../queries/customer-import-reads.query.ts';
import {
  commitCommand,
  customerImportFixture,
  customerWorkbook,
  previewCommand,
  type CustomerImportFixture,
} from './customer-import.fixture.ts';

let f: CustomerImportFixture;
beforeAll(async () => {
  f = await customerImportFixture();
});
afterAll(async () => {
  await f?.close();
});

const VALID = [
  ['أحمد', '98765432', '', '', '', '', '', 'ذكر', '', 'ملاحظة'],
  ['سالم', '98765433', '', '', '', '', '', 'أنثى', '', ''],
] as const;

it('serves a bilingual xlsx template with the ten authoritative headers', async () => {
  const result = await f.template.execute({
    companyId: f.company,
    userId: f.userId,
    scope: { kind: 'business', id: f.business },
  });
  expect(result.content_type).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const bytes = Buffer.from(result.content_base64, 'base64');
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
});

it('refuses the template of a business outside the company', async () => {
  await expect(
    f.template.execute({
      companyId: f.company,
      userId: f.userId,
      scope: { kind: 'business', id: f.otherBusiness },
    }),
  ).rejects.toThrow(new CustomerImportError('NOT_FOUND'));
});

it('previews a verified workbook without writing any customer', async () => {
  const fileId = await f.upload(await customerWorkbook(VALID));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  expect(preview.row_count).toBe(2);
  expect(preview.new_count).toBe(2);
  expect(preview.existing_count).toBe(0);
  expect(preview.error_count).toBe(0);
  expect(preview.rows.map((row) => row.masked_phone)).toEqual(['***432', '***433']);
  expect(JSON.stringify(preview)).not.toContain('98765432');
  const [count] =
    await f.owner`SELECT count(*)::int AS n FROM customers WHERE company_id=${f.company}`;
  expect(count?.['n']).toBe(0);
});

it('previews a branch scope against the business of that branch', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId, 'branch'));
  expect(preview.row_count).toBe(1);
});

it('refuses a preview until the business country is set', async () => {
  await f.owner`UPDATE businesses SET settings='{}'::jsonb
    WHERE company_id=${f.company} AND id=${f.business}`;
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  await expect(f.preview.execute(previewCommand(f, fileId))).rejects.toThrow(
    new CustomerImportError('IMPORT_BUSINESS_COUNTRY_REQUIRED'),
  );
  await f.owner`UPDATE businesses SET settings='{"country":"KW"}'::jsonb
    WHERE company_id=${f.company} AND id=${f.business}`;
});

it('refuses a file that belongs to another creator', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]), {
    createdBy: f.ownerUserId,
  });
  await expect(f.preview.execute(previewCommand(f, fileId))).rejects.toThrow(
    new CustomerImportError('IMPORT_FILE_NOT_FOUND'),
  );
});

it('serves the preview rows and status to its creator only and isolates tenants', async () => {
  const fileId = await f.upload(await customerWorkbook(VALID));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  const input = {
    companyId: f.company,
    userId: f.userId,
    scope: { kind: 'business' as const, id: f.business },
    previewId: preview.preview_id,
  };
  const first = await customerImportRowsPage(f.db, customerImportScopeReads, {
    ...input,
    cursor: undefined,
    limit: 1,
  });
  expect(first.items.map((row) => row.row)).toEqual([2]);
  expect(first.next_cursor).toBe('2');
  const second = await customerImportRowsPage(f.db, customerImportScopeReads, {
    ...input,
    cursor: first.next_cursor ?? undefined,
    limit: 1,
  });
  expect(second.items.map((row) => row.row)).toEqual([3]);
  expect(second.next_cursor).toBeNull();
  const status = await customerImportStatusQuery(f.db, customerImportScopeReads, input);
  expect(status).toMatchObject({ preview_id: preview.preview_id, status: 'ready' });
  const foreign = await customerImportStatusQuery(f.db, customerImportScopeReads, {
    ...input,
    userId: f.ownerUserId,
  }).catch((error: unknown) => error);
  expect(foreign).toMatchObject({ code: 'IMPORT_PREVIEW_NOT_FOUND' });
  const crossTenant = await customerImportStatusQuery(f.db, customerImportScopeReads, {
    ...input,
    companyId: f.otherCompany,
  }).catch((error: unknown) => error);
  expect(crossTenant).toMatchObject({ code: 'IMPORT_PREVIEW_NOT_FOUND' });
});

it('counts all parsed rows including invalid ones in row_count and blocks commit on errors', async () => {
  const mixed = [VALID[0], ['سارة', 'bad-phone', '', '', '', '', '', '', '', '']] as const;
  const fileId = await f.upload(await customerWorkbook(mixed));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  expect(preview.row_count).toBe(2);
  expect(preview.new_count).toBe(1);
  expect(preview.error_count).toBeGreaterThan(0);
  await expect(f.commit.execute(commitCommand(f, preview.preview_id, 'key-err'))).rejects.toThrow(
    new CustomerImportError('IMPORT_PREVIEW_HAS_ERRORS'),
  );
});

it('requests one commit and replays it with the same or a new key without a second event', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  const accepted = await f.commit.execute(commitCommand(f, preview.preview_id, 'key-one'));
  expect(accepted.preview_id).toBe(preview.preview_id);
  const replay = await f.commit.execute(commitCommand(f, preview.preview_id, 'key-one'));
  expect(replay.preview_id).toBe(preview.preview_id);
  const newKey = await f.commit.execute(commitCommand(f, preview.preview_id, 'key-one-new'));
  expect(newKey.preview_id).toBe(preview.preview_id);
  const [events] = await f.owner`SELECT count(*)::int AS n FROM outbox
    WHERE aggregate_id=${preview.preview_id} AND event_type='CustomerImportCommitRequested'`;
  expect(events?.['n']).toBe(1);
});

it('records the file access in the audit log', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  await f.preview.execute(previewCommand(f, fileId));
  const [entry] = await f.owner`SELECT action FROM audit_log
    WHERE entity='file' AND entity_id=${fileId}`;
  expect(entry?.['action']).toBe('import_previewed');
});

it('refuses commits for another creator or wrong business scope without storing idempotency keys', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  await expect(
    f.commit.execute({
      ...commitCommand(f, preview.preview_id, 'key-two'),
      userId: f.ownerUserId,
    }),
  ).rejects.toThrow(new CustomerImportError('IMPORT_PREVIEW_NOT_FOUND'));
  const secondBiz = systemUuidV7().newId();
  await f.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type,settings)
    VALUES (${f.company},${secondBiz},'Synthetic second biz','salon','{"country":"KW"}')`;
  await expect(
    f.commit.execute({
      ...commitCommand(f, preview.preview_id, 'key-scope'),
      scope: { kind: 'business', id: secondBiz },
    }),
  ).rejects.toThrow(new CustomerImportError('IMPORT_PREVIEW_NOT_FOUND'));
  const [keys] = await f.owner`SELECT count(*)::int AS n FROM idempotency_keys
    WHERE company_id=${f.company} AND key IN ('key-two', 'key-scope')`;
  expect(keys?.['n']).toBe(0);
});

it('handles existing phones, bad headers, missing storage, expired commits, and PG retry errors', async () => {
  const existingCustomer = systemUuidV7().newId();
  await f.owner`INSERT INTO customers(company_id,id,name,phone,locale,gender,created_at,updated_at)
    VALUES (${f.company},${existingCustomer},'أحمد القائم','+96598765432','ar','male',now(),now())`;
  try {
    const fileId = await f.upload(await customerWorkbook(VALID));
    const mixed = await f.preview.execute(previewCommand(f, fileId));
    expect(mixed).toMatchObject({ new_count: 1, existing_count: 1, error_count: 0 });
    const badHeader = await f.upload(await customerWorkbook([VALID[0]], ['wrong']));
    await expect(f.preview.execute(previewCommand(f, badHeader))).rejects.toThrow(
      new CustomerImportError('IMPORT_HEADER_INVALID'),
    );
    const missingFile = await f.upload(await customerWorkbook([VALID[0]]));
    const [row] = await f.owner`SELECT storage_key FROM file_objects WHERE id=${missingFile}`;
    f.storage.delete(String(row?.['storage_key']));
    await expect(f.preview.execute(previewCommand(f, missingFile))).rejects.toThrow(
      new CustomerImportError('STORAGE_UNAVAILABLE'),
    );
    f.clock.value = new Date('2026-11-28T00:00:00Z');
    await expect(
      f.commit.execute(commitCommand(f, mixed.preview_id, 'key-expired')),
    ).rejects.toThrow(new CustomerImportError('IMPORT_PREVIEW_EXPIRED'));
  } finally {
    f.clock.value = new Date('2026-11-26T10:00:00Z');
    await f.owner`DELETE FROM customers WHERE id=${existingCustomer}`;
  }
  expect(() => cleanCustomerImportError({ code: '40001' })).toThrow(
    new CustomerImportError('TRANSACTION_RETRY_REQUIRED'),
  );
  expect(typeof CUSTOMER_IMPORT_SCOPE_READS).toBe('symbol');
});

it('EXPLAIN ANALYZE uses import_previews_pkey without Seq Scan on rows and status queries', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  const ids = systemUuidV7();
  const bulk = Array.from({ length: 500 }, () => ids.newId());
  await f.owner`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status)
    SELECT p.company_id,k.id,p.business_id,p.entity,p.file_id,p.created_by,p.created_at,p.expires_at,
      p.row_count,p.error_count,p.rows,p.errors,p.status
    FROM (SELECT company_id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status
      FROM import_previews WHERE id=${preview.preview_id} LIMIT 1) p CROSS JOIN unnest(${bulk}::uuid[]) k(id)`;
  await f.owner`ANALYZE import_previews`;
  const [rowsPlan, statusPlan] = await f.db.withTenant(
    f.company,
    async (tx) => [
      await tx.execute(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${customerImportRowsPageStatement({
          companyId: f.company,
          businessId: f.business,
          userId: f.userId,
          previewId: preview.preview_id,
          after: 1,
          limit: 20,
        })}`,
      ),
      await tx.execute(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${customerImportStatusStatement({
          companyId: f.company,
          businessId: f.business,
          userId: f.userId,
          previewId: preview.preview_id,
        })}`,
      ),
    ],
    { userId: f.userId },
  );
  for (const plan of [JSON.stringify(rowsPlan), JSON.stringify(statusPlan)]) {
    expect(plan).toContain('import_previews_pkey');
    expect(plan).not.toContain('"Node Type":"Seq Scan"');
  }
});

const sendHttp = (
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  payload?: object,
) => f.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });

const managerHeaders = (extra: Record<string, string> = {}) => ({
  cookie: 'sid=manager',
  'x-company-id': f.company,
  ...extra,
});

it('serves template, preview, rows, status, and commit over real HTTP routes', async () => {
  const base = `/v1/branches/${f.branch}/customers/import`;
  const tpl = await sendHttp(
    'GET',
    `/v1/businesses/${f.business}/customers/import/template`,
    managerHeaders(),
  );
  expect(tpl.statusCode).toBe(200);
  expect(tpl.json()['file_name']).toBe('customers-import-template.xlsx');
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  const created = await sendHttp('POST', `${base}/previews`, managerHeaders(), { file_id: fileId });
  expect(created.statusCode).toBe(201);
  const previewId = String(created.json()['preview_id']);
  expect(
    (await sendHttp('GET', `${base}/previews/${previewId}/rows`, managerHeaders())).statusCode,
  ).toBe(200);
  expect(
    (await sendHttp('GET', `${base}/previews/${previewId}`, managerHeaders())).json(),
  ).toMatchObject({
    status: 'ready',
  });
  const committed = await sendHttp(
    'POST',
    `${base}/commits`,
    managerHeaders({ 'idempotency-key': 'http-branch-1' }),
    { preview_id: previewId },
  );
  expect(committed.statusCode).toBe(202);
});

it('enforces HTTP auth, permissions, feature flag, idempotency header, and storage readiness', async () => {
  const base = `/v1/branches/${f.branch}/customers/import`;
  expect(
    (
      await sendHttp('GET', `/v1/businesses/${f.business}/customers/import/template`, {
        'x-company-id': f.company,
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await sendHttp('GET', `/v1/businesses/${f.business}/customers/import/template`, {
        cookie: 'sid=member',
        'x-company-id': f.company,
      })
    ).json(),
  ).toMatchObject({ code: 'FORBIDDEN' });
  expect(
    (await sendHttp('GET', `${base}/template`, { cookie: 'sid=member', 'x-company-id': f.company }))
      .statusCode,
  ).toBe(403);
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  const created = await sendHttp('POST', `${base}/previews`, managerHeaders(), { file_id: fileId });
  const previewId = String(created.json()['preview_id']);
  expect(
    (await sendHttp('POST', `${base}/commits`, managerHeaders(), { preview_id: previewId }))
      .statusCode,
  ).toBe(400);
  await f.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'customers',false,'HTTP test',${f.userId})`;
  try {
    expect((await sendHttp('GET', `${base}/template`, managerHeaders())).json()).toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  } finally {
    await f.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='customers'`;
  }
  const bare = await f.startHttpApp(false);
  try {
    const noStorage = await bare.inject({
      method: 'POST',
      url: `/v1/businesses/${f.business}/customers/import/previews`,
      headers: managerHeaders(),
      payload: { file_id: fileId },
    });
    expect(noStorage.statusCode).toBe(503);
    expect(noStorage.json()['code']).toBe('STORAGE_NOT_CONFIGURED');
  } finally {
    await bare.close();
  }
});
