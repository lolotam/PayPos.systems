import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  CommitPackageImport,
  PackageCommitRetryError,
} from '../use-cases/commit-package-import/commit-package-import.ts';
import { packageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import { RecoverPackageImports } from '../use-cases/recover-package-imports/recover-package-imports.ts';
import type { PackageCommitScope } from '../ports/package-import-commit.port.ts';
import {
  COMMIT_TIMEOUT_MS,
  packageImportRecoveryFixture,
  STALE,
  type PackageImportRecoveryFixture,
} from './package-import-recovery.fixture.ts';

let h: PackageImportRecoveryFixture;
// نفس لحظة النافذة بعد ميلي ثانية واحدة: الطلب الأصغر سنًا من حد العشر دقائق.
const YOUNG = '2026-11-05T11:50:00.001Z';

beforeAll(async () => {
  h = await packageImportRecoveryFixture();
});
afterAll(async () => {
  if (h) await h.f.close();
});

async function moneyCounts(id: string) {
  const [entitlements] = await h.f
    .owner`SELECT count(*)::int AS n FROM package_entitlements WHERE import_batch_id=${id}`;
  const [slots] = await h.f.owner`SELECT count(*)::int AS n FROM package_session_slots s
    JOIN package_entitlements e ON e.company_id=s.company_id AND e.id=s.entitlement_id
    WHERE e.import_batch_id=${id}`;
  const [audits] = await h.f
    .owner`SELECT count(*)::int AS n FROM audit_log WHERE entity_id=${id} AND action='import.committed'`;
  const [events] = await h.f
    .owner`SELECT count(*)::int AS n FROM outbox WHERE aggregate_id=${id} AND event_type='ImportCommitted'`;
  return {
    entitlements: entitlements?.['n'],
    slots: slots?.['n'],
    audits: audits?.['n'],
    events: events?.['n'],
  };
}

it('fails a request aged exactly ten minutes and spares a younger one, another tenant and another entity', async () => {
  const { f, sweep, staleRequest } = h;
  const boundary = await staleRequest('boundary', STALE);
  const young = await staleRequest('young', YOUNG);
  const employeesRow = f.ids.newId();
  await f.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,
    status,requested_at,row_count,error_count,rows,errors)
    SELECT company_id,${employeesRow},business_id,'employees',file_id,created_by,created_at,expires_at,
      'commit_requested',requested_at,0,0,'[]','[]' FROM import_previews WHERE id=${boundary}`;
  await sweep().execute(f.otherCompany);
  expect(
    (await f.owner`SELECT status FROM import_previews WHERE id=${boundary}`)[0]?.['status'],
  ).toBe('commit_requested');
  await sweep().execute(f.company);
  expect(
    (
      await f.owner`SELECT status,error_code,created_count FROM import_previews WHERE id=${boundary}`
    )[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_COMMIT_FAILED', created_count: 0 });
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${young}`)[0]?.['status']).toBe(
    'commit_requested',
  );
  expect(
    (await f.owner`SELECT status FROM import_previews WHERE id=${employeesRow}`)[0]?.['status'],
  ).toBe('commit_requested');
});

it('commits nothing when the job runs after the sweep closed the request', async () => {
  const { f, sweep, committer, staleRequest } = h;
  const id = await staleRequest('sweep-wins', STALE);
  await sweep().execute(f.company);
  await committer().execute(f.company, id);
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_COMMIT_FAILED' });
  expect(await moneyCounts(id)).toEqual({ entitlements: 0, slots: 0, audits: 0, events: 0 });
});

it('redelivery after a lost commit reply leaves every money count unchanged', async () => {
  const { f, committer, staleRequest } = h;
  const id = await staleRequest('redelivery', STALE);
  await committer().execute(f.company, id);
  const before = await moneyCounts(id);
  expect(before).toEqual({ entitlements: 1, slots: 730, audits: 1, events: 1 });
  await committer().execute(f.company, id);
  expect(await moneyCounts(id)).toEqual(before);
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
    'committed',
  );
});

it('a final-attempt fail after a successful commit changes nothing', async () => {
  const { f, committer, staleRequest } = h;
  const id = await staleRequest('final-noop', STALE);
  await committer().execute(f.company, id);
  await committer().fail(f.company, id, 'IMPORT_COMMIT_FAILED');
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'committed', error_code: null });
});

it('the sweep after a winning commit keeps status, code, created count and entitlements intact', async () => {
  const { f, sweep, committer, staleRequest } = h;
  const id = await staleRequest('commit-first', STALE);
  await committer().execute(f.company, id);
  await sweep().execute(f.company);
  expect(
    (await f.owner`SELECT status,error_code,created_count FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'committed', error_code: null, created_count: 1 });
  expect(
    await f.owner`SELECT id FROM package_entitlements WHERE import_batch_id=${id}`,
  ).toHaveLength(1);
});

it('drains a backlog of sixty stale requests in one execute', async () => {
  const { f, sweep, staleRequest, clone } = h;
  const id = await staleRequest('backlog', STALE);
  await clone(id, 60, STALE);
  await sweep().execute(f.company);
  const [remaining] = await f.owner`SELECT count(*)::int AS n FROM import_previews
    WHERE company_id=${f.company} AND entity='packages' AND status='commit_requested' AND requested_at<=${STALE}`;
  expect(remaining?.['n']).toBe(0);
  const [failed] = await f.owner`SELECT count(*)::int AS n FROM import_previews
    WHERE rows->0->>'external_ref' LIKE 'backlog-%' AND status='failed' AND error_code='IMPORT_COMMIT_FAILED'`;
  expect(failed?.['n']).toBe(61);
});

it('stops one execute after twenty full pages and leaves the rest to the next minute', async () => {
  let pages = 0;
  const alwaysFull = {
    hasPending: async () => true,
    failStalePage: async (): Promise<number> => {
      pages += 1;
      return 50;
    },
  };
  await new RecoverPackageImports(alwaysFull, h.f.clock).execute(h.f.company);
  expect(pages).toBe(20);
});

it('a coded refusal finalized after the sweep keeps the generic code as the stored outcome', async () => {
  const { f, sweep, committer, staleRequest } = h;
  const id = await staleRequest('refusal-after-sweep', STALE);
  await sweep().execute(f.company);
  // الرفض كان معلقًا في progress ولم يُثبَّت؛ المسح سبقه، والتخزين المشروط لا يعيد فتح الحالة ولا يصحح الرمز.
  await committer().fail(f.company, id, 'IMPORT_PREVIEW_EXPIRED');
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_COMMIT_FAILED' });
});

it('an aged request with a fresh job stores exactly one outcome whichever of commit and sweep runs first', async () => {
  const { f, sweep, committer, staleRequest } = h;
  // عمر المهمة حارس إعادة المحاولة لا موعد قبول؛ أهلية المسح تُقاس من requested_at، وأي ترتيب يخزّن نتيجة ذرّية واحدة.
  const commitFirst = await staleRequest('aged-commit-first', STALE);
  await committer().execute(f.company, commitFirst);
  await sweep().execute(f.company);
  expect(
    (
      await f.owner`SELECT status,error_code,created_count FROM import_previews WHERE id=${commitFirst}`
    )[0],
  ).toMatchObject({ status: 'committed', error_code: null, created_count: 1 });

  const sweepFirst = await staleRequest('aged-sweep-first', STALE);
  await sweep().execute(f.company);
  await committer().execute(f.company, sweepFirst);
  expect(
    (
      await f.owner`SELECT status,error_code,created_count FROM import_previews WHERE id=${sweepFirst}`
    )[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_COMMIT_FAILED', created_count: 0 });
  expect(await moneyCounts(sweepFirst)).toEqual({
    entitlements: 0,
    slots: 0,
    audits: 0,
    events: 0,
  });
});

it('a rolled-back first attempt writes the full import exactly once on the second execute', async () => {
  const { f, staleRequest } = h;
  const id = await staleRequest('rollback-retry', STALE);
  const real = packageImportCommitTransactions(f.database, f.ids, { timeoutMs: COMMIT_TIMEOUT_MS });
  let first = true;
  const injected = {
    ...real,
    run: (
      companyId: string,
      previewId: string,
      work: (scope: PackageCommitScope) => Promise<void>,
    ) =>
      first
        ? real.run(companyId, previewId, async (scope) => {
            await work(scope);
            // الإفلات بعد اكتمال الكتابات يجبر التراجع؛ لا شيء يبقى من المحاولة الأولى.
            first = false;
            throw new Error('Synthetic rollback after the writes');
          })
        : real.run(companyId, previewId, work),
  };
  const retried = new CommitPackageImport(injected, f.clock);
  await expect(retried.execute(f.company, id)).rejects.toThrow(PackageCommitRetryError);
  expect(await moneyCounts(id)).toEqual({ entitlements: 0, slots: 0, audits: 0, events: 0 });
  await retried.execute(f.company, id);
  expect(await moneyCounts(id)).toEqual({ entitlements: 1, slots: 730, audits: 1, events: 1 });
  expect(
    (await f.owner`SELECT status,error_code,created_count FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'committed', error_code: null, created_count: 1 });
});
