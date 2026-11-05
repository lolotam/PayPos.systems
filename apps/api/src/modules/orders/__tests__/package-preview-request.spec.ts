import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { RequestPackageImportPreviewUseCase } from '../use-cases/request-package-import-preview/request-package-import-preview.usecase.ts';
import { createPackageImportRequestTransactions } from '../persistence/package-import-request.transactions.ts';
import { packageImportPreviewAccepted, packageImportPreviewRequested } from '@pospay/contracts';
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

it('accepts 202 without object storage and atomically stores an empty pending preview plus an id-only event', async () => {
  const fileId = await f.upload();
  const response = await f.h.app.inject({
    method: 'POST',
    url: f.url,
    headers: f.headers,
    payload: { file_id: fileId },
  });
  expect(response.statusCode).toBe(202);
  const { preview_id } = packageImportPreviewAccepted.parse(response.json());
  const [preview] = await f.h
    .owner`SELECT status,row_count,error_count,skipped_count,rows,errors,requested_at,created_by,file_id
    FROM import_previews WHERE company_id=${f.companyId} AND id=${preview_id}`;
  expect(preview).toEqual({
    status: 'pending',
    row_count: 0,
    error_count: 0,
    skipped_count: 0,
    rows: [],
    errors: [],
    requested_at: null,
    created_by: f.userId,
    file_id: fileId,
  });
  const events = await f.h
    .owner`SELECT event_type,payload FROM outbox WHERE company_id=${f.companyId} AND aggregate_id=${preview_id}`;
  expect(events).toEqual([
    { event_type: 'PackageImportPreviewRequested', payload: { preview_id } },
  ]);
  expect(packageImportPreviewRequested.parse(events[0]?.['payload'])).toEqual({ preview_id });
  expect(
    await f.h.owner`SELECT id FROM package_entitlements WHERE company_id=${f.companyId}`,
  ).toEqual([]);
});

it('rolls back the pending row when outbox insertion fails', async () => {
  const fileId = await f.upload();
  const duplicateEvent = f.ids.newId();
  await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(sql`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload)
      VALUES (${f.companyId},${duplicateEvent},'test',${fileId},'TestEvent','{}'::jsonb)`);
  });
  const transactions = createPackageImportRequestTransactions(f.database, {
    newId: () => duplicateEvent,
  });
  const previewId = f.ids.newId();
  const useCase = new RequestPackageImportPreviewUseCase(
    transactions,
    { newId: () => previewId },
    { now: () => new Date() },
  );
  await expect(useCase.execute(f.command(fileId))).rejects.toThrow();
  expect(await f.h.owner`SELECT id FROM import_previews WHERE id=${previewId}`).toEqual([]);
});

it.each(['unknown', 'business', 'creator', 'pending', 'purging', 'type', 'size'] as const)(
  'rejects invalid %s facts without an outbox event',
  async (scenario) => {
    const fileId = await f.upload();
    if (scenario === 'business')
      await f.h.owner`UPDATE file_objects SET business_id=${f.otherBusinessId} WHERE id=${fileId}`;
    if (scenario === 'creator')
      await f.h
        .owner`UPDATE file_objects SET created_by=(SELECT id FROM "user" WHERE id<>${f.userId} LIMIT 1) WHERE id=${fileId}`;
    if (scenario === 'pending')
      await f.h.owner`UPDATE file_objects SET status='PENDING',storage_key=NULL WHERE id=${fileId}`;
    if (scenario === 'purging')
      await f.h.owner`UPDATE file_objects SET purge_started_at=now() WHERE id=${fileId}`;
    if (scenario === 'type')
      await f.h.owner`UPDATE file_objects SET content_type='application/pdf' WHERE id=${fileId}`;
    if (scenario === 'size')
      await f.h.owner`UPDATE file_objects SET size_bytes=2097153 WHERE id=${fileId}`;
    const command = f.command(scenario === 'unknown' ? f.ids.newId() : fileId);
    await expect(f.useCase.execute(command)).rejects.toMatchObject({
      name: 'PackageImportRequestError',
    });
    expect(await f.h.owner`SELECT id FROM import_previews WHERE file_id=${fileId}`).toEqual([]);
  },
);

it('refuses revoked permission and disabled orders at acceptance', async () => {
  const fileId = await f.upload();
  await f.h
    .owner`UPDATE permission_overrides SET effect='DENY' WHERE company_id=${f.companyId} AND permission_code='import:packages:business'`;
  try {
    await expect(f.useCase.execute(f.command(fileId))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`UPDATE permission_overrides SET effect='ALLOW' WHERE company_id=${f.companyId} AND permission_code='import:packages:business'`;
  }
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.companyId},'orders',false,'Synthetic test',${f.userId})`;
  try {
    await expect(f.useCase.execute(f.command(fileId))).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.companyId} AND flag='orders'`;
  }
});

it('keeps warm full acceptance below 200 ms at the maximum file-facts bound', async () => {
  const file_id = await f.upload();
  const accept = () =>
    f.h.app.inject({ method: 'POST', url: f.url, headers: f.headers, payload: { file_id } });
  expect((await accept()).statusCode).toBe(202);
  const times: number[] = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    const response = await accept();
    times.push(performance.now() - start);
    expect(response.statusCode).toBe(202);
    expect(packageImportPreviewAccepted.safeParse(response.json()).success).toBe(true);
  }
  const median = times.toSorted((a, b) => a - b)[2] ?? Infinity;
  process.stdout.write(
    `PACKAGE_PREVIEW_REQUEST_WARM ${JSON.stringify({ warm_ms: times, median_ms: median })}\n`,
  );
  expect(median).toBeLessThan(200);
});

it('holds company and caller membership write locks through authorization', async () => {
  await createPackageImportRequestTransactions(f.database, f.ids).run(f, async (scope) => {
    await scope.authorize();
    await expect(
      f.h.owner.begin(async (other) => {
        await other`SET LOCAL lock_timeout='100ms'`;
        await other`UPDATE companies SET id=id WHERE id=${f.companyId}`;
      }),
    ).rejects.toMatchObject({ code: '55P03' });
    await expect(
      f.h.owner.begin(async (other) => {
        await other`SET LOCAL lock_timeout='100ms'`;
        await other`UPDATE memberships SET id=id WHERE company_id=${f.companyId} AND user_id=${f.userId}`;
      }),
    ).rejects.toMatchObject({ code: '55P03' });
  });
});
