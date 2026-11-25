import { afterAll, beforeAll, expect, it } from 'vitest';
import { RecoverServiceImports } from '../use-cases/recover-service-imports/recover-service-imports.ts';
import {
  serviceImportRecoveryFixture,
  STALE,
  YOUNG,
  type ServiceImportRecoveryFixture,
} from './service-import-recovery.fixture.ts';

let h: ServiceImportRecoveryFixture;
// الطلب الأقدم في صفحة القفل: قبل حد العشر دقائق، فيسبق البقية في ORDER BY requested_at,id.
const OLDEST = '2026-11-22T11:40:00Z';

beforeAll(async () => {
  h = await serviceImportRecoveryFixture();
});
afterAll(async () => {
  if (h) await h.close();
});

it('fails a services request aged exactly ten minutes and spares the young, the foreign and the other entities', async () => {
  const { sweep, staleRequest, entityRequest } = h;
  const boundary = await staleRequest('boundary', STALE);
  const young = await staleRequest('young', YOUNG);
  const employees = await entityRequest('employees', STALE);
  const packages = await entityRequest('packages', STALE);
  const foreign = await entityRequest('services', STALE, {
    companyId: h.otherCompany,
    businessId: h.otherBusiness,
  });
  await sweep().execute(h.company);
  expect(
    (await h.owner`SELECT status FROM import_previews WHERE company_id=${h.otherCompany} AND id=${foreign}`)[0]
      ?.['status'],
  ).toBe('commit_requested');
  expect(await h.previewRow(boundary)).toMatchObject({
    status: 'failed',
    error_code: 'IMPORT_COMMIT_FAILED',
    created_count: 0,
  });
  expect((await h.owner`SELECT status FROM import_previews WHERE id=${young}`)[0]?.['status']).toBe(
    'commit_requested',
  );
  for (const id of [employees, packages]) {
    expect((await h.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
      'commit_requested',
    );
  }
});

it('skips the locked oldest row without waiting behind its lock, and fails it on the next sweep', async () => {
  const { sweep, staleRequest, clone, holdRow } = h;
  const id = await staleRequest('page-lock', OLDEST);
  await clone(id, 59, STALE);
  const holder = holdRow(id);
  await holder.heldPromise;
  try {
    const started = Date.now();
    await sweep().execute(h.company);
    // الحد يفرّق «لم ينتظر خلف القفل» عن مهلة العبارة (5 ثوانٍ)، وليس سرعة تحديث 50 صفًا.
    expect(Date.now() - started).toBeLessThan(8000);
    expect((await h.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
      'commit_requested',
    );
    const [failed] = await h.owner`SELECT count(*)::int AS n FROM import_previews
      WHERE company_id=${h.company} AND entity='services' AND status='failed'
        AND rows->0->>'name_en' LIKE 'page-lock%'`;
    expect(failed?.['n']).toBe(59);
  } finally {
    holder.release();
    await holder.settled;
  }
  await sweep().execute(h.company);
  expect(await h.previewRow(id)).toMatchObject({
    status: 'failed',
    error_code: 'IMPORT_COMMIT_FAILED',
  });
}, 30000);

it('drains a backlog of sixty stale requests in one execute', async () => {
  const { sweep, staleRequest, clone } = h;
  const id = await staleRequest('backlog', STALE);
  await clone(id, 60, STALE);
  await sweep().execute(h.company);
  const [remaining] = await h.owner`SELECT count(*)::int AS n FROM import_previews
    WHERE company_id=${h.company} AND entity='services' AND status='commit_requested'
      AND requested_at<=${STALE} AND rows->0->>'name_en' LIKE 'backlog%'`;
  expect(remaining?.['n']).toBe(0);
  const [failed] = await h.owner`SELECT count(*)::int AS n FROM import_previews
    WHERE company_id=${h.company} AND entity='services' AND status='failed'
      AND error_code='IMPORT_COMMIT_FAILED' AND rows->0->>'name_en' LIKE 'backlog%'`;
  expect(failed?.['n']).toBe(61);
});

it('stops one execute after twenty full pages and leaves the rest to the next minute', async () => {
  let pages = 0;
  const alwaysFull = {
    failStalePage: async (): Promise<number> => {
      pages += 1;
      return 50;
    },
  };
  await new RecoverServiceImports(alwaysFull, { now: () => h.clock.value }).execute(h.company);
  expect(pages).toBe(20);
});

it('uses the tenant/status/request index for the full sweep statement inside a rolled-back transaction', async () => {
  const { staleRequest, clone, explain } = h;
  const id = await staleRequest('explain-plan', STALE);
  await clone(id, 500, STALE);
  await h.owner`ANALYZE import_previews`;
  const plan = await explain(new Date('2000-01-01'));
  expect(plan).toContain('import_previews_company_status_requested_idx');
});
