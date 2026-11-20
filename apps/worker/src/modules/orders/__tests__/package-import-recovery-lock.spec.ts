import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { packageImportCommitStaleBefore } from '../domain/package-import-recovery.ts';
import { packageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import {
  packageImportRecoveryPage,
  packageImportRecoveryTransactions,
} from '../persistence/package-import-recovery.transactions.ts';
import {
  COMMIT_TIMEOUT_MS,
  packageImportRecoveryFixture,
  STALE,
  type PackageImportRecoveryFixture,
} from './package-import-recovery.fixture.ts';

let h: PackageImportRecoveryFixture;
// الطلب الأقدم في صفحة القفل: دقيقة كاملة قبل حد العشر دقائق، فيسبق البقية في ORDER BY requested_at,id.
const OLDEST = '2026-11-05T11:49:00Z';

beforeAll(async () => {
  h = await packageImportRecoveryFixture();
});
afterAll(async () => {
  if (h) await h.f.close();
});

/** حامل قفل صف حقيقي على اتصال owner مستقل حتى يُستدعى الإفراج. */
function holdRow(id: string) {
  let held!: () => void;
  const heldPromise = new Promise<void>((resolve) => {
    held = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = h.f.owner
    .begin(async (tx) => {
      await tx`SELECT id FROM import_previews WHERE company_id=${h.f.company} AND id=${id} FOR UPDATE`;
      held();
      await gate;
      throw new Error('holder rollback');
    })
    .catch(() => undefined);
  return { heldPromise, release: () => release(), settled: holding };
}

/** أصغر صفحة مهيأة: الطلب الأقدم لُقِفل لحظة التجهيز والبقية بنفس لحظة القبول. */
async function lockedOldestPage(prefix: string): Promise<string> {
  // لحظة الأقدم تُحدَّد مع الانتقال نفسه: عقد قاعدة البيانات يمنع تعديل requested_at بعده.
  const id = await h.staleRequest(prefix, OLDEST);
  await h.clone(id, 59, STALE);
  return id;
}

it('skips the locked oldest row, drains the page exactly, and fails the remainder after release', async () => {
  const { f } = h;
  const id = await lockedOldestPage('page-lock');
  const transactions = packageImportRecoveryTransactions(f.database, { timeoutMs: 5_000 });
  const holder = holdRow(id);
  await holder.heldPromise;
  try {
    const before = packageImportCommitStaleBefore(f.clock.now());
    const started = Date.now();
    expect(await transactions.failStalePage(f.company, before)).toBe(50);
    // الحد يفرّق «لم ينتظر خلف القفل» عن مهلة العبارة (5 ثوانٍ)، وليس سرعة تحديث 50 صفًا على مشغّل مشترك.
    expect(Date.now() - started).toBeLessThan(3000);
    expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
      'commit_requested',
    );
    expect(await transactions.failStalePage(f.company, before)).toBe(9);
  } finally {
    holder.release();
    await holder.settled;
  }
  expect(
    await transactions.failStalePage(f.company, packageImportCommitStaleBefore(f.clock.now())),
  ).toBe(1);
}, 30000);

it('sweep execute returns without spinning while the oldest row of the page is held', async () => {
  const { f, sweep } = h;
  const id = await lockedOldestPage('no-spin');
  const holder = holdRow(id);
  await holder.heldPromise;
  try {
    const started = Date.now();
    await sweep().execute(f.company);
    // صفحتان تفشلان 59 والثالثة فارغة؛ العودة أسرع من مهلة العبارة بكثير فلا دوران خلف القفل.
    expect(Date.now() - started).toBeLessThan(8000);
    expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
      'commit_requested',
    );
    const [failed] = await f.owner`SELECT count(*)::int AS n FROM import_previews
      WHERE rows->0->>'external_ref' LIKE 'no-spin-%' AND status='failed' AND error_code='IMPORT_COMMIT_FAILED'`;
    expect(failed?.['n']).toBe(59);
  } finally {
    holder.release();
    await holder.settled;
  }
  await sweep().execute(f.company);
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_COMMIT_FAILED' });
}, 30000);

it('uses the tenant/status/request index for the full sweep statement inside a rolled-back transaction', async () => {
  const { f, staleRequest, clone } = h;
  const id = await staleRequest('explain-plan', STALE);
  await clone(id, 500, STALE);
  await f.owner`ANALYZE import_previews`;
  let plan = '';
  // EXPLAIN ANALYZE ينفذ التحديث فعليًا؛ الرول-باك المتعمد يلغي أثره على بيانات الاختبار.
  await expect(
    f.db.withTenant(f.company, async (tx) => {
      const rows = await tx.execute(
        sql`EXPLAIN ANALYZE ${packageImportRecoveryPage(f.company, new Date('2000-01-01'))}`,
      );
      plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      throw new Error('EXPLAIN_ROLLBACK');
    }),
  ).rejects.toThrow('EXPLAIN_ROLLBACK');
  expect(plan).toContain('import_previews_company_status_requested_idx');
});

it('the bounded fail rejects on its five-second lock wait instead of waiting behind the holder', async () => {
  const { f, staleRequest } = h;
  const id = await staleRequest('bounded-fail', STALE);
  const base = packageImportCommitTransactions(f.database, f.ids, { timeoutMs: COMMIT_TIMEOUT_MS });
  const holder = holdRow(id);
  await holder.heldPromise;
  // ساعة أمان تفرج الحاجز لو مهلة withTenant لم تُفعَّل، فيغرق الاختبار بإشارة فشل واضحة لا بالتعليق.
  const watchdog = setTimeout(holder.release, 12_000);
  try {
    // هذه مهلة انتظار القفل (5 ث + سماح جدولة) فقط، وليست ساعة نتيجة التثبيت التي يقودها use case في الإنتاج.
    const started = Date.now();
    await expect(base.fail(f.company, id, 'IMPORT_COMMIT_FAILED')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(8_000);
  } finally {
    holder.release();
    await holder.settled;
    clearTimeout(watchdog);
  }
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
    'commit_requested',
  );
}, 30000);
