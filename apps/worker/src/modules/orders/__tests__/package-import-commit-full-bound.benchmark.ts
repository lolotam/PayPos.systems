import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { CommitPackageImport } from '../use-cases/commit-package-import/commit-package-import.ts';
import { packageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import {
  packagePreviewFixture,
  packageWorkbook,
  type PackagePreviewFixture,
} from './package-preview.fixture.ts';
let f: PackagePreviewFixture;
let membership: string;
const timeoutMs = 30 * 60 * 1000; // Benchmark ceiling, not a measured production budget.
beforeAll(async () => {
  f = await packagePreviewFixture();
  membership = f.ids.newId();
  const [role] = await f.owner`SELECT id FROM roles WHERE company_id IS NULL AND code='owner'`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${membership},${USER},${role?.['id']},'global','COMPANY',${f.company})`;
});
afterAll(async () => {
  if (f) await f.close();
});
function worker() {
  return new CommitPackageImport(
    packageImportCommitTransactions(f.database, f.ids, { timeoutMs }),
    f.clock,
  );
}
async function accepted(prefix: string, count = 1, groups = 2) {
  const { id } = await f.requested(await packageWorkbook(count, groups, prefix));
  await f.worker.execute(f.company, id);
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`UPDATE import_previews SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',
      commit_membership_id=${membership} WHERE id=${id}`);
  });
  return id;
}
// Opt-in config selects this benchmark; the normal src/**/*.spec.ts glob excludes it.
it(
  'BENCHMARK full 3,650,000-slot completed COMMIT and peak memory',
  async () => {
    const id = await accepted('full-bound', 500, 20);
    let peakRss = process.memoryUsage().rss;
    let peakHeap = process.memoryUsage().heapUsed;
    const sampler = setInterval(() => {
      const m = process.memoryUsage();
      peakRss = Math.max(peakRss, m.rss);
      peakHeap = Math.max(peakHeap, m.heapUsed);
    }, 10);
    const started = performance.now();
    try {
      await worker().execute(f.company, id);
      const elapsedMs = performance.now() - started;
      const [count] = await f.owner`SELECT count(*)::int AS slots FROM package_session_slots s
      JOIN package_entitlements e ON e.company_id=s.company_id AND e.id=s.entitlement_id WHERE e.import_batch_id=${id}`;
      expect(count?.['slots']).toBe(3650000);
      expect(
        (await f.owner`SELECT status,created_count FROM import_previews WHERE id=${id}`)[0],
      ).toMatchObject({ status: 'committed', created_count: 500 });
      console.info(
        JSON.stringify({
          elapsedMs,
          peakRss,
          peakHeap,
          timeoutMs,
          completedCommit: true,
          slots: 3650000,
        }),
      );
    } finally {
      clearInterval(sampler);
    }
  },
  timeoutMs + 120000,
);
