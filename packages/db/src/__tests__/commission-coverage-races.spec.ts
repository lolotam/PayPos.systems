import { COMMISSION_COVERAGE_PROOF_VERSION } from '@pospay/domain';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { asReplicaOwner } from '../../test/owner-cleanup.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

// ADR-0054 (إضافة 2026-11-22) §8 و§10 اختبار 6: سباقات قفل صف الحالة. البوابة (وهي قفل الاعتماد FOR SHARE
// الممسوك لآخر معاملة الاعتماد) والإبطال والإصدار وهجرة الإصدار كلها تمسك الصف نفسه: رابح واحد يمسكه
// والباقي ينتظر، فلا يكتمل إبطال ولا إصدار في نصّ اعتماد. كل سباق بحاجز قفل حقيقي واستطلاع بميزانية
// محدودة، بلا نوم ثابت.
const { A } = TENANT;
const STATE_ID = '01980000-0000-7000-8000-00000000aa02';
const POLL_MS = 25;
const BUDGET_MS = 15_000;
const TEST_TIMEOUT_MS = 120_000;

let test: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;
let dispatcher: postgres.Sql;
let proofCounter = 0;

beforeAll(async () => {
  test = await createTestDatabase();
  await seedTwoTenants(test.ownerUrl);
  // الاتصال الواحد يكفي لصف واحد مسكوك؛ السباق يحتاج اتصالات مستقلة، فالبركة أكبر من واحد.
  owner = postgres(test.ownerUrl, { max: 4, onnotice: () => undefined });
  app = postgres(test.appUrl, { max: 4, onnotice: () => undefined });
  dispatcher = postgres(test.dispatcherUrl, { max: 4, onnotice: () => undefined });
});

afterAll(async () => {
  await dispatcher?.end();
  await app?.end();
  await owner?.end();
  await test?.drop();
});

beforeEach(async () => {
  await asReplicaOwner(owner, async (tx) => {
    await tx`DELETE FROM commission_coverage_proofs`;
    await tx`DELETE FROM commission_coverage_state`;
  });
});

afterEach(async () => {
  // (§10 اختبار 6) هجرة الإصدار ترفع النسخة المطلوبة، فترجعها هنا عشان الاختبارات اللي بعدها تبدأ من 1.
  await owner`CREATE OR REPLACE FUNCTION public.commission_coverage_required_version() RETURNS integer
    LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT 1 $$`;
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** هوية قاعدة البيانات وحدّ البقشيش (يوم database + يوم)، زي ما يقراها المُصدِر. */
interface Identity {
  readonly name: string;
  readonly systemId: string;
  readonly bound: string;
}

/**
 * يقرأ هوية قاعدة البيانات والحدّ الزمني للبقشيش.
 *
 * @returns هوية قاعدة البيانات والحدّ
 */
async function identity(): Promise<Identity> {
  const [row] = await owner<{ name: string; system_id: string; bound: string }[]>`
    SELECT current_database()::text AS name, public.pospay_system_id()::text AS system_id,
      ((now() AT TIME ZONE 'UTC')::date + 1)::text AS bound`;
  if (row === undefined) throw new Error('the database identity is unavailable');
  return { name: row.name, systemId: row.system_id, bound: row.bound };
}

/**
 * يضمن صف الحالة ويقرأ جيله بدور المرسِل، كما يفعل أمر التغطية قبل الإصدار.
 *
 * @param company الشركة
 * @returns جيل صف الحالة
 */
async function ensureState(company: string): Promise<number> {
  const [row] = await dispatcher<{ generation: string }[]>`
    SELECT out_generation::text AS generation
    FROM public.current_commission_coverage_generation(${company}::uuid, ${STATE_ID}::uuid)`;
  return Number(row?.['generation']);
}

/**
 * يصدر إثباتًا بدور المرسِل على الجيل المتوقع، كما يفعل أمر التغطية.
 *
 * @param tx معاملة المرسّل
 * @param company الشركة
 * @param generation الجيل المتوقع
 * @returns الجيل اللي اتحمل عليه الإثبات
 */
async function issueIn(
  tx: postgres.TransactionSql,
  company: string,
  generation: number,
): Promise<number> {
  const id = await identity();
  proofCounter += 1;
  const proofId = `01980000-0000-7000-8000-${(0xbb0100 + proofCounter).toString(16).padStart(12, '0')}`;
  const [row] = await tx`SELECT public.issue_commission_coverage_proof(
      ${company}::uuid, ${proofId}::uuid, ${generation}::bigint,
      ${COMMISSION_COVERAGE_PROOF_VERSION}::integer, ARRAY[${A.business}]::uuid[],
      '2026-01-01'::date, ${id.bound}::date, ${id.bound}::date, NULL::uuid,
      ${id.name}::text, ${id.systemId}::bigint, 'race-run', 'race')::text AS generation`;
  return Number(row?.['generation']);
}

/**
 * يبطل التغطية بدور التطبيق بسياق الشركة، كما يفعل كاتب مصدر من البيانات.
 *
 * @param tx معاملة التطبيق
 * @param company الشركة
 * @returns الجيل بعد الإبطال
 */
async function invalidateIn(
  tx: postgres.TransactionSql,
  company: string,
): Promise<number> {
  await tx`SELECT set_config('app.company_id', ${company}, true)`;
  const [row] = await tx`SELECT public.invalidate_commission_coverage(${STATE_ID}::uuid, 'SOURCE_WRITE')::text AS generation`;
  return Number(row?.['generation']);
}

class RolledBack {
  readonly rows: Record<string, unknown>[];

  constructor(rows: Record<string, unknown>[]) {
    this.rows = rows;
  }
}

/**
 * البوابة كما يقرؤها الاعتماد: pospay_app بسياق الشركة. المعاملة تتراجع عشان الضمان يتراجع.
 *
 * @param company الشركة
 * @returns صفوف البوابة
 */
async function gateRows(company: string): Promise<Record<string, unknown>[]> {
  try {
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${company}, true)`;
      const rows = await tx`SELECT * FROM public.read_commission_coverage_gate(${STATE_ID}::uuid)`;
      throw new RolledBack([...rows]);
    });
  } catch (error) {
    if (error instanceof RolledBack) return error.rows;
    throw error;
  }
  throw new Error('The gate transaction did not roll back');
}

interface Held {
  /** معرّف العملية (pid) اللي ماسكة المعاملة. */
  readonly pid: number;
  /** يتحل لما الشغل جوه المعاملة يخلص والقفل ممسوك. */
  readonly work: Promise<unknown>;
  /** يتحل لما المعاملة تتراجع أو تلتزم. */
  readonly done: Promise<unknown>;
  /** يفرج عن المعاملة فيرسلها تلتزم. */
  release(): void;
}

/**
 * يفتح معاملة على اتصال مستقل، ينفّذ الشغل جواها (فتُقفل الصفوف)، ويبقيها مفتوحة حتى يُستدعى release.
 * الـpid بيتحدد مع فتح المعاملة، والـwork بيتحل بعد ما الشغل يخلص — فالمتصل يعلم متى القفل ممسوك.
 *
 * @param sql الاتصال
 * @param work الشغل جوه المعاملة
 * @returns المعاملة الممسوكة
 */
async function hold(
  sql: postgres.Sql,
  work: (tx: postgres.TransactionSql) => Promise<unknown>,
): Promise<Held> {
  let release: () => void = () => undefined;
  let opened: (pid: number) => void = () => undefined;
  let finished: (value: unknown) => void = () => undefined;
  let failed: (error: unknown) => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const workDone = new Promise<unknown>((resolve, reject) => {
    finished = resolve;
    failed = reject;
  });
  const pidReady = new Promise<number>((resolve) => {
    opened = resolve;
  });
  const done = sql.begin(async (tx) => {
    const [row] = await tx`SELECT pg_backend_pid()::int AS pid`;
    opened(row?.['pid'] as number);
    try {
      const result = await work(tx);
      finished(result);
    } catch (error) {
      failed(error);
      throw error;
    }
    await released;
  });
  const pid = await pidReady;
  // القفل الممسوك بيتفرّج عنه في كل الأحوال (حتى لو فشل تأكيد في نصّ الاختبار)، فما بيقفلش باقي الاختبارات.
  onTestFinished(async () => {
    release();
    await done.catch(() => undefined);
  });
  return { pid, work: workDone, done: done.catch(() => undefined), release };
}

/**
 * عدد الاتصالات اللي ماسكة قفل المعامل ده (هو اللي بيستنى).
 *
 * @param pid معرّف العملية
 * @returns عدد الحاجزين
 */
async function blockersOf(pid: number): Promise<number> {
  const [row] = await owner<{ blockers: number }[]>`
    SELECT coalesce(array_length(pg_blocking_pids(${pid}), 1), 0)::int AS blockers`;
  return row?.['blockers'] ?? 0;
}

/**
 * ينتظر حتى يقف المعامل ده على قفل، أو يفشل عند انتهاء الميزانية.
 *
 * @param pid معرّف العملية
 * @param what اسم ما ينتظره الاختبار
 */
async function waitForWaiter(pid: number, what: string): Promise<void> {
  const deadline = Date.now() + BUDGET_MS;
  while (Date.now() < deadline) {
    if ((await blockersOf(pid)) > 0) return;
    await sleep(POLL_MS);
  }
  throw new Error(`${what}: the transaction ${pid} never waited on a lock within ${BUDGET_MS} ms`);
}

/**
 * يتحقق أن المعامل ده ممسوك من المعامل التاني بالظبط.
 *
 * @param waiter معرّف العملية المنتظرة
 * @param holder معرّف العملية الحاجبة
 * @returns true لو الحاجب هو ده
 */
async function blockedBy(waiter: number, holder: number): Promise<boolean> {
  const [row] = await owner<{ blocked: boolean }[]>`
    SELECT ${holder} = ANY(pg_blocking_pids(${waiter})) AS blocked`;
  return row?.['blocked'] === true;
}

/**
 * جيل صف الحالة والسبب المحفوظين.
 *
 * @param company الشركة
 * @returns الجيل والسبب
 */
async function stateRow(
  company: string,
): Promise<{ generation: string; reason: string } | undefined> {
  const [row] = await owner<{ generation: string; reason: string }[]>`
    SELECT generation::text AS generation, reason FROM commission_coverage_state WHERE company_id = ${company}`;
  return row;
}

describe('the invalidation racing the approval gate (ADR-0054 §8)', () => {
  it('makes the invalidator wait for the gate share lock, and the proof stops being current once it commits', async () => {
    const generation = await ensureState(A.company);
    const issued = await dispatcher.begin((tx) => issueIn(tx, A.company, generation));
    let gateSeen: Record<string, unknown>[] = [];
    const gate = await hold(app, async (tx) => {
      await tx`SELECT set_config('app.company_id', ${A.company}, true)`;
      gateSeen = [...(await tx`SELECT * FROM public.read_commission_coverage_gate(${STATE_ID}::uuid)`)];
    });
    const invalidator = await hold(app, (tx) => invalidateIn(tx, A.company));

    await waitForWaiter(invalidator.pid, 'the invalidation behind the approval gate');
    expect(await blockedBy(invalidator.pid, gate.pid)).toBe(true);
    // الاعتماد تحت القفل ما زال يشوف الإثبات كاملًا قبل ما الإبطال يلتزم.
    expect(gateSeen).toHaveLength(1);

    gate.release();
    await gate.done;
    const invalidated = (await invalidator.work) as number;
    invalidator.release();
    await invalidator.done;

    expect(invalidated).toBe(issued + 1);
    expect(await stateRow(A.company)).toMatchObject({
      generation: String(issued + 1),
      reason: 'SOURCE_WRITE',
    });
    expect(await gateRows(A.company)).toEqual([]);
  }, TEST_TIMEOUT_MS);
});

describe('the issuance racing the approval gate (ADR-0054 §8)', () => {
  it('makes the issuer wait for the gate share lock, and leaves exactly one current proof', async () => {
    const generation = await ensureState(A.company);
    const issued = await dispatcher.begin((tx) => issueIn(tx, A.company, generation));
    let gateSeen: Record<string, unknown>[] = [];
    const gate = await hold(app, async (tx) => {
      await tx`SELECT set_config('app.company_id', ${A.company}, true)`;
      gateSeen = [...(await tx`SELECT * FROM public.read_commission_coverage_gate(${STATE_ID}::uuid)`)];
    });
    const issuer = await hold(dispatcher, (tx) => issueIn(tx, A.company, issued));

    await waitForWaiter(issuer.pid, 'the issuance behind the approval gate');
    expect(await blockedBy(issuer.pid, gate.pid)).toBe(true);
    // الاعتماد تحت القفل ما زال يشوف الإثبات القديم كاملًا؛ ما ينفع يتشاف نص إثبات.
    expect(gateSeen).toHaveLength(1);
    expect(gateSeen[0]?.['out_version']).toBe(COMMISSION_COVERAGE_PROOF_VERSION);

    gate.release();
    await gate.done;
    const issuedGeneration = (await issuer.work) as number;
    issuer.release();
    await issuer.done;

    expect(issuedGeneration).toBe(issued + 1);
    expect(await stateRow(A.company)).toMatchObject({ generation: String(issued + 1) });
    const proofs = await owner<{ generation: string }[]>`
      SELECT generation::text AS generation FROM commission_coverage_proofs
      WHERE company_id = ${A.company} ORDER BY generation`;
    expect(proofs.map((row) => row.generation)).toEqual([String(issued), String(issued + 1)]);
    expect(await gateRows(A.company)).toHaveLength(1);
  }, TEST_TIMEOUT_MS);
});

describe('the release migration racing the approval gate (ADR-0054 §5 and §8)', () => {
  it('makes the migration wait for the gate share lock, and the gate after its commit refuses the old proof', async () => {
    const generation = await ensureState(A.company);
    await dispatcher.begin((tx) => issueIn(tx, A.company, generation));
    const gate = await hold(app, async (tx) => {
      await tx`SELECT set_config('app.company_id', ${A.company}, true)`;
      await tx`SELECT * FROM public.read_commission_coverage_gate(${STATE_ID}::uuid)`;
    });
    const migration = await hold(owner, async (tx) => {
      await tx`CREATE OR REPLACE FUNCTION public.commission_coverage_required_version() RETURNS integer
        LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT 2 $$`;
      await tx`UPDATE commission_coverage_state SET generation = generation + 1,
        bumped_at = pg_catalog.clock_timestamp(), reason = 'RELEASE' WHERE company_id = ${A.company}`;
    });

    await waitForWaiter(migration.pid, 'the release migration behind the approval gate');
    expect(await blockedBy(migration.pid, gate.pid)).toBe(true);

    gate.release();
    await gate.done;
    await migration.work;
    migration.release();
    await migration.done;

    // (§10 اختبار 6) البوابة بعد التزام الهجرة بترفض الإثبات بالنسخة القديمة.
    expect(await gateRows(A.company)).toEqual([]);
    const [version] = await owner<{ version: number }[]>`
      SELECT public.commission_coverage_required_version()::int AS version`;
    expect(version?.['version']).toBe(2);
    expect(await stateRow(A.company)).toMatchObject({ reason: 'RELEASE' });
  }, TEST_TIMEOUT_MS);
});

describe('an issue racing an invalidation (ADR-0054 §8)', () => {
  it('refuses the issuance with COVERAGE_GENERATION_MOVED when the invalidation commits first', async () => {
    const generation = await ensureState(A.company);
    const invalidator = await hold(app, (tx) => invalidateIn(tx, A.company));
    const issuer = await hold(dispatcher, (tx) => issueIn(tx, A.company, generation));

    await waitForWaiter(issuer.pid, 'the issuance behind the invalidation');
    expect(await blockedBy(issuer.pid, invalidator.pid)).toBe(true);

    invalidator.release();
    await invalidator.done;

    await expect(issuer.work).rejects.toThrow('COVERAGE_GENERATION_MOVED');
    await issuer.done;
    expect(await stateRow(A.company)).toMatchObject({ reason: 'SOURCE_WRITE' });
    const proofs = await owner`SELECT count(*)::int AS total FROM commission_coverage_proofs
      WHERE company_id = ${A.company}`;
    expect(proofs[0]?.['total']).toBe(0);
  }, TEST_TIMEOUT_MS);

  it('applies the invalidation to the locked value and leaves the issued proof not current', async () => {
    const generation = await ensureState(A.company);
    const issuer = await hold(dispatcher, (tx) => issueIn(tx, A.company, generation));
    const issuedGeneration = (await issuer.work) as number;
    const invalidator = await hold(app, (tx) => invalidateIn(tx, A.company));

    await waitForWaiter(invalidator.pid, 'the invalidation behind the issuance');
    expect(await blockedBy(invalidator.pid, issuer.pid)).toBe(true);

    issuer.release();
    await issuer.done;
    const invalidated = (await invalidator.work) as number;
    invalidator.release();
    await invalidator.done;

    expect(issuedGeneration).toBe(generation + 1);
    expect(invalidated).toBe(generation + 2);
    expect(await gateRows(A.company)).toEqual([]);
    const proofs = await owner<{ generation: string }[]>`
      SELECT generation::text AS generation FROM commission_coverage_proofs
      WHERE company_id = ${A.company} ORDER BY generation`;
    expect(proofs.map((row) => row.generation)).toEqual([String(generation + 1)]);
  }, TEST_TIMEOUT_MS);
});

describe('two concurrent invalidators (ADR-0054 §1 and §8)', () => {
  it('lets both succeed, each bump applied to the locked value', async () => {
    const first = await hold(app, (tx) => invalidateIn(tx, A.company));
    const firstBump = (await first.work) as number;
    const second = await hold(app, (tx) => invalidateIn(tx, A.company));

    await waitForWaiter(second.pid, 'the second invalidator behind the first');
    expect(await blockedBy(second.pid, first.pid)).toBe(true);

    first.release();
    await first.done;
    const secondBump = (await second.work) as number;
    second.release();
    await second.done;

    expect(firstBump).toBe(1);
    expect(secondBump).toBe(2);
    expect(await stateRow(A.company)).toMatchObject({
      generation: '2',
      reason: 'SOURCE_WRITE',
    });
    expect(await gateRows(A.company)).toEqual([]);
  }, TEST_TIMEOUT_MS);
});
