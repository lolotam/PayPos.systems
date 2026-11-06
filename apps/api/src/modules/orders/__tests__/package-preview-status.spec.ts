import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  packageImportPreviewStatusQuery,
  packagePreviewStatusStatement,
} from '../queries/package-import-preview-status.query.ts';
import {
  packagePreviewRequestFixture,
  type PackagePreviewRequestFixture,
} from './package-preview-request.fixture.ts';

let f: PackagePreviewRequestFixture;
beforeAll(async () => {
  f = await packagePreviewRequestFixture();
});
afterAll(async () => {
  await f?.close();
});
const actor = (previewId: string) => ({
  companyId: f.companyId,
  businessId: f.businessId,
  userId: f.userId,
  previewId,
});

it('reports an expired pending preview as failed even if its outbox event never reaches a worker', async () => {
  const { preview_id } = await f.useCase.execute(f.command(await f.upload()));
  const expired = f.ids.newId();
  await f.h
    .owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,status,row_count,error_count,rows,errors)
    SELECT company_id,${expired},business_id,entity,file_id,created_by,now()-interval '2 days',now()-interval '1 day','pending',0,0,'[]','[]'
    FROM import_previews WHERE id=${preview_id}`;
  const response = await f.h.app.inject({
    method: 'GET',
    url: `${f.url}/${expired}`,
    headers: f.headers,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    preview_id: expired,
    status: 'failed',
    error_code: 'IMPORT_FILE_NOT_FOUND',
  });
  expect(
    (await f.h.owner`SELECT status FROM import_previews WHERE id=${expired}`)[0]?.['status'],
  ).toBe('pending');
});

it('polls pending, ready and failed without exposing stored rows, phones or file keys', async () => {
  const { preview_id } = await f.useCase.execute(f.command(await f.upload()));
  const pending = await f.h.app.inject({
    method: 'GET',
    url: `${f.url}/${preview_id}`,
    headers: f.headers,
  });
  expect(pending.statusCode).toBe(200);
  expect(pending.json()).toEqual({ preview_id, status: 'pending' });
  await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(
      sql`UPDATE import_previews SET status='ready',row_count=2,skipped_count=1,
      source_rows='[2,3]'::jsonb,skipped_rows='[3]'::jsonb,
      rows='[{"row":2,"customer_id":"safe","phone_last3":"678"}]'::jsonb WHERE id=${preview_id}`,
    );
  });
  expect(await packageImportPreviewStatusQuery(f.database, actor(preview_id))).toEqual({
    preview_id,
    status: 'ready',
    row_count: 2,
    error_count: 0,
    skipped_count: 1,
    errors: [],
  });
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`UPDATE import_previews
    SET status='failed',error_code='STORAGE_UNAVAILABLE' WHERE id=${preview_id}`),
    ),
  ).rejects.toThrow();
  const failed = await f.useCase.execute(f.command(await f.upload()));
  await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(
      sql`UPDATE import_previews SET status='failed',error_code='STORAGE_UNAVAILABLE' WHERE id=${failed.preview_id}`,
    );
  });
  expect(await packageImportPreviewStatusQuery(f.database, actor(failed.preview_id))).toEqual({
    preview_id: failed.preview_id,
    status: 'failed',
    error_code: 'STORAGE_UNAVAILABLE',
  });
});

it('uses the same unknown refusal for another creator, business, tenant, entity or missing id', async () => {
  const { preview_id } = await f.useCase.execute(f.command(await f.upload()));
  for (const lookup of [
    { ...actor(preview_id), userId: f.ids.newId() },
    { ...actor(preview_id), businessId: f.otherBusinessId },
    { ...actor(preview_id), companyId: f.ids.newId() },
    actor(f.ids.newId()),
  ])
    await expect(packageImportPreviewStatusQuery(f.database, lookup)).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_NOT_FOUND',
    });
  const fileId = await f.upload();
  const staffId = f.ids.newId();
  await f.h
    .owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${f.companyId},${staffId},${f.businessId},'employees',${fileId},${f.userId},now(),now()+interval '1 day',0,0,'[]','[]')`;
  await expect(packageImportPreviewStatusQuery(f.database, actor(staffId))).rejects.toMatchObject({
    code: 'IMPORT_PREVIEW_NOT_FOUND',
  });
});

it('keeps the creator lookup on the tenant/id key with a directly projected DTO', async () => {
  const { preview_id } = await f.useCase.execute(f.command(await f.upload()));
  const keys = Array.from({ length: 1000 }, () => f.ids.newId());
  await f.h
    .owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,status,row_count,error_count,rows,errors)
    SELECT p.company_id,k.id,p.business_id,p.entity,p.file_id,p.created_by,p.created_at,p.expires_at,'pending',0,0,'[]','[]'
    FROM import_previews p CROSS JOIN unnest(${keys}::uuid[]) AS k(id) WHERE p.id=${preview_id}`;
  await f.h.owner`ANALYZE import_previews`;
  await f.database.withTenant(f.companyId, async (tx) => {
    const plan = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${packagePreviewStatusStatement(actor(preview_id))}`,
    );
    const text = JSON.stringify(plan);
    expect(text).toMatch(/Index(?: Only)? Scan/);
    expect(text).toContain('Index Cond');
    expect(text).toContain('company_id =');
    expect(text).toContain('id =');
    expect(text).toContain('Execution Time');
  });
});

it('enforces pending/result update constraints without changing staff commit transitions', async () => {
  const { preview_id } = await f.useCase.execute(f.command(await f.upload()));
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`UPDATE import_previews SET row_count=1 WHERE id=${preview_id}`),
    ),
  ).rejects.toThrow();
  await f.database.withTenant(f.companyId, (tx) =>
    tx.execute(
      sql`UPDATE import_previews SET status='failed',error_code='IMPORT_FILE_CONTENT_INVALID' WHERE id=${preview_id}`,
    ),
  );
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(
        sql`UPDATE import_previews SET status='ready',error_code=NULL WHERE id=${preview_id}`,
      ),
    ),
  ).rejects.toThrow();
  const fileId = await f.upload();
  const staffId = f.ids.newId();
  await f.h
    .owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${f.companyId},${staffId},${f.businessId},'employees',${fileId},${f.userId},now(),now()+interval '1 day',0,0,'[]','[]')`;
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`UPDATE import_previews SET rows='[{}]'::jsonb WHERE id=${staffId}`),
    ),
  ).rejects.toThrow();
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`UPDATE import_previews SET status='pending' WHERE id=${staffId}`),
    ),
  ).rejects.toThrow();
  await f.database.withTenant(f.companyId, (tx) =>
    tx.execute(
      sql`UPDATE import_previews SET status='commit_requested',requested_at=now() WHERE id=${staffId}`,
    ),
  );
  expect(
    await f.h.owner`SELECT status,skipped_count FROM import_previews WHERE id=${staffId}`,
  ).toEqual([{ status: 'commit_requested', skipped_count: 0 }]);
});

it('preserves cross-tenant write isolation and grants the new trigger function only to app', async () => {
  const { preview_id } = await f.useCase.execute(f.command(await f.upload()));
  const other = f.ids.newId();
  const updated = await f.database.withTenant(other, (tx) =>
    tx.execute(sql`UPDATE import_previews
    SET status='failed',error_code='STORAGE_UNAVAILABLE' WHERE company_id=${f.companyId} AND id=${preview_id} RETURNING id`),
  );
  expect(updated).toHaveLength(0);
  expect(await packageImportPreviewStatusQuery(f.database, actor(preview_id))).toEqual({
    preview_id,
    status: 'pending',
  });
  const [privileges] = await f.h.owner`SELECT
    has_function_privilege('pospay_app','package_import_preview_update_guard()','EXECUTE') AS app,
    has_function_privilege('pospay_auth','package_import_preview_update_guard()','EXECUTE') AS auth,
    has_function_privilege('pospay_dispatcher','package_import_preview_update_guard()','EXECUTE') AS dispatcher,
    (SELECT count(*)::int FROM pg_proc p,aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid='package_import_preview_update_guard()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_grants`;
  expect(privileges).toEqual({ app: true, auth: false, dispatcher: false, public_grants: 0 });
});

it('freezes failed preview results', async () => {
  const { preview_id } = await f.useCase.execute(f.command(await f.upload()));
  await f.database.withTenant(f.companyId, (tx) =>
    tx.execute(sql`UPDATE import_previews
    SET status='failed',error_code='IMPORT_FILE_CONTENT_INVALID' WHERE id=${preview_id}`),
  );
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`UPDATE import_previews
    SET error_code='IMPORT_FILE_UNAVAILABLE' WHERE id=${preview_id}`),
    ),
  ).rejects.toMatchObject({ cause: { code: '23514', message: 'IMPORT_PREVIEW_FAILED_IMMUTABLE' } });
  expect(await packageImportPreviewStatusQuery(f.database, actor(preview_id))).toMatchObject({
    status: 'failed',
    error_code: 'IMPORT_FILE_CONTENT_INVALID',
  });
});

it('rejects illegal accepted-commit mutations and cross-tenant failure writes', async () => {
  const id = await acceptedFinancialPreview();
  const before = await financialState(id);
  for (const change of [
    sql`status='ready'`,
    sql`status='failed',error_code='IMPORT_COMMIT_FAILED',requested_at=requested_at+interval '1 second'`,
    sql`status='committed',created_count=1,committed_at=now()`,
  ]) {
    await expect(
      f.database.withTenant(f.companyId, (tx) =>
        tx.execute(sql`UPDATE import_previews SET ${change} WHERE id=${id} RETURNING id`),
      ),
    ).rejects.toMatchObject({
      cause: { code: '23514', message: 'IMPORT_PREVIEW_TRANSITION_INVALID' },
    });
    expect(await financialState(id)).toEqual(before);
  }
  const otherTenant = await f.database.withTenant(f.ids.newId(), (tx) =>
    tx.execute(
      sql`UPDATE import_previews SET status='failed',error_code='IMPORT_COMMIT_FAILED' WHERE id=${id} RETURNING id`,
    ),
  );
  expect(otherTenant).toHaveLength(0);
  expect(await financialState(id)).toEqual(before);
});

it.each(['failed', 'committed'] as const)(
  'allows accepted package commit to %s and freezes the terminal row',
  async (status) => {
    const id = await acceptedFinancialPreview();
    const change =
      status === 'failed'
        ? sql`status='failed',error_code='IMPORT_COMMIT_FAILED'`
        : sql`status='committed',committed_at=now(),created_count=0`;
    const updated = await f.database.withTenant(f.companyId, (tx) =>
      tx.execute(
        sql`UPDATE import_previews SET ${change} WHERE id=${id} RETURNING id,status,created_count,error_code,committed_at`,
      ),
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      id,
      status,
      created_count: 0,
      error_code: status === 'failed' ? 'IMPORT_COMMIT_FAILED' : null,
    });
    if (status === 'committed') expect(updated[0]?.['committed_at']).not.toBeNull();
    else expect(updated[0]?.['committed_at']).toBeNull();
    const before = await financialState(id);
    for (const target of [
      'ready',
      'commit_requested',
      status === 'failed' ? 'committed' : 'failed',
    ]) {
      await expect(
        f.database.withTenant(f.companyId, (tx) =>
          tx.execute(
            sql`UPDATE import_previews SET status=${target},committed_at=NULL,error_code='IMPORT_FILE_UNAVAILABLE'
        WHERE id=${id} RETURNING id`,
          ),
        ),
      ).rejects.toMatchObject({
        cause: {
          code: '23514',
          message:
            status === 'failed'
              ? 'IMPORT_PREVIEW_FAILED_IMMUTABLE'
              : 'IMPORT_PREVIEW_TRANSITION_INVALID',
        },
      });
      expect(await financialState(id)).toEqual(before);
    }
  },
);

async function acceptedFinancialPreview() {
  const { preview_id: id } = await f.useCase.execute(f.command(await f.upload()));
  await f.database.withTenant(f.companyId, async (tx) => {
    expect(
      await tx.execute(sql`UPDATE import_previews SET status='ready',row_count=1,skipped_count=1,source_rows='[2]'::jsonb,skipped_rows='[2]'::jsonb
      WHERE id=${id} RETURNING id,status`),
    ).toEqual([{ id, status: 'ready' }]);
    expect(
      await tx.execute(sql`UPDATE import_previews SET status='commit_requested',requested_at=now(),commit_membership_id=${f.membershipId}
      WHERE id=${id} RETURNING id,status`),
    ).toEqual([{ id, status: 'commit_requested' }]);
  });
  return id;
}

async function financialState(id: string) {
  return (await f.h.owner`SELECT to_jsonb(p) AS value FROM import_previews p WHERE id=${id}`)[0]?.[
    'value'
  ];
}
