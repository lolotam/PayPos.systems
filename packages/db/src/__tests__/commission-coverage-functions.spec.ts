import { COMMISSION_COVERAGE_PROOF_VERSION, COMMISSION_INPUT_EVENT_TYPES } from '@pospay/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { asReplicaOwner } from '../../test/owner-cleanup.ts';
import { eventId, pendingCountHarness } from '../../test/statement-pending-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

// ADR-0054 (إضافة 2026-11-22) §1 و§2 و§7: دوال إثبات التغطية بالأدوار الفعلية. المُصدِر يُستدعى بدور المرسِل، والبوابة
// والإبطال بدور التطبيق تحت سياق الشركة، ولا أحد منهما يلمس الجدولين مباشرة.
const { A, B } = TENANT;
let proofCounter = 0;
const nextProofId = (): string =>
  `01980000-0000-7000-8000-${(0xaa0100 + ++proofCounter).toString(16).padStart(12, '0')}`;
const STATE_ID = '01980000-0000-7000-8000-00000000aa02';
const CONSUMER = 'commissions.project-inputs';

let test: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;
let dispatcher: postgres.Sql;
const { seedEvent, markEvent, clean } = pendingCountHarness(
  () => owner,
  () => app,
);

beforeAll(async () => {
  test = await createTestDatabase();
  await seedTwoTenants(test.ownerUrl);
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  app = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
  dispatcher = postgres(test.dispatcherUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await dispatcher.end();
  await app.end();
  await owner.end();
  await test.drop();
});

beforeEach(async () => {
  await clean();
  await asReplicaOwner(owner, async (tx) => {
    await tx`DELETE FROM commission_coverage_proofs`;
    await tx`DELETE FROM commission_coverage_state`;
  });
});

class RolledBack {
  readonly rows: Record<string, unknown>[];

  constructor(rows: Record<string, unknown>[]) {
    this.rows = rows;
  }
}

/** يقرأ الإثبات الحالي كما يقرؤه الاعتماد: بدور التطبيق وسياق الشركة، ثم يلغي المعاملة كلها (الضمان يتراجع). */
async function gate(company: string): Promise<Record<string, unknown>[]> {
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

interface Identity {
  readonly name: string;
  readonly systemId: string;
  readonly bound: string;
}

async function identity(): Promise<Identity> {
  const [row] = await owner<
    { name: string; system_id: string; bound: string }[]
  >`SELECT current_database()::text AS name, public.pospay_system_id()::text AS system_id,
      ((now() AT TIME ZONE 'UTC')::date + 1)::text AS bound`;
  if (row === undefined) throw new Error('identity unavailable');
  return { name: row.name, systemId: row.system_id, bound: row.bound };
}

interface IssueOverrides {
  readonly company?: string;
  readonly generation?: number;
  readonly version?: number;
  readonly businesses?: readonly string[];
  readonly tipFrom?: string;
  readonly tipTo?: string | null;
  readonly verifiedBound?: string | null;
  readonly reportThrough?: string | null;
  readonly database?: string;
}

/** يصدر إثباتًا بدور المرسِل؛ كل معامل يمكن تغييره لإثبات رفض بعينه. */
async function issue(overrides: IssueOverrides = {}): Promise<number> {
  const id = await identity();
  const businesses = [...(overrides.businesses ?? [A.business])];
  const [row] = await dispatcher<{ generation: string }[]>`SELECT public.issue_commission_coverage_proof(
      ${overrides.company ?? A.company}::uuid, ${nextProofId()}::uuid, ${overrides.generation ?? 0}::bigint,
      ${overrides.version ?? COMMISSION_COVERAGE_PROOF_VERSION}::integer, ${businesses}::uuid[],
      ${overrides.tipFrom ?? '2026-01-01'}::date, ${overrides.tipTo ?? id.bound}::date,
      ${overrides.verifiedBound ?? id.bound}::date, ${overrides.reportThrough ?? null}::uuid,
      ${overrides.database ?? id.name}::text, ${id.systemId}::bigint, 'run-1', 'release-1')::text AS generation`;
  return Number(row?.['generation']);
}

async function ensureState(company: string): Promise<void> {
  await dispatcher`SELECT * FROM public.current_commission_coverage_generation(${company}::uuid, ${STATE_ID}::uuid)`;
}

describe('the gate read', () => {
  it('returns nothing without a proof, and a refused approval leaves no state row behind', async () => {
    expect(await gate(A.company)).toEqual([]);

    const [count] = await owner`SELECT count(*)::int AS n FROM commission_coverage_state`;
    expect(count?.['n']).toBe(0);
  });

  it('lets the issuer role run pospay_system_id and its inner pg_control_system, as the dispatcher connection sees it', async () => {
    const [row] = await dispatcher`SELECT out_system_id::text AS system_id
      FROM public.current_commission_coverage_generation(${A.company}::uuid, ${STATE_ID}::uuid)`;

    expect(row?.['system_id']).toBe((await identity()).systemId);
    expect(row?.['system_id']).not.toBe('0');
  });

  it('runs the whole issue function body and stamps the connecting role as the issuer', async () => {
    await ensureState(A.company);
    await issue();

    const [row] = await owner`SELECT issued_by, run_id, release FROM commission_coverage_proofs`;

    expect(row).toEqual({ issued_by: 'pospay_dispatcher', run_id: 'run-1', release: 'release-1' });
  });

  it('returns the issued proof with the binary rules it was stamped with', async () => {
    await ensureState(A.company);
    expect(await issue()).toBe(1);

    const [proof] = await gate(A.company);

    expect(proof).toMatchObject({
      out_version: COMMISSION_COVERAGE_PROOF_VERSION,
      out_business_ids: [A.business],
      out_counted_types: [...COMMISSION_INPUT_EVENT_TYPES],
      out_consumer_id: CONSUMER,
    });
    expect(proof?.['out_database_name']).toBe((await identity()).name);
  });

  it.each([
    ['a proof of another rules version', "version = 2"],
    ['a proof issued on another database name', "database_name = 'copied_database'"],
  ])('withholds %s even when its generation is current (defence in depth)', async (_label, change) => {
    await ensureState(A.company);
    await issue();
    await asReplicaOwner(owner, (tx) =>
      tx.unsafe(`UPDATE commission_coverage_proofs SET ${change} WHERE company_id = '${A.company}'`),
    );

    expect(await gate(A.company)).toEqual([]);
  });

  it('never shows one company the proof of another', async () => {
    await ensureState(A.company);
    await issue();

    expect(await gate(B.company)).toEqual([]);
  });
});

describe('the issuer refusals', () => {
  beforeEach(ensureState.bind(null, A.company));

  it.each([
    ['a different rules version', { version: 2 }, 'COVERAGE_VERSION_REFUSED'],
    ['a business list that omits one of the company businesses', { businesses: [] }, 'COVERAGE_SCOPE_INCOMPLETE'],
    ['a tip range that ends before the tip bound', { tipTo: '2020-01-01' }, 'COVERAGE_SCOPE_INCOMPLETE'],
    ['a tip bound that is not the database day', { verifiedBound: '2020-01-02' }, 'COVERAGE_TIP_BOUND_MOVED'],
    ['a stale generation', { generation: 7 }, 'COVERAGE_GENERATION_MOVED'],
    ['a report from another database name', { database: 'another_database' }, 'COVERAGE_DATABASE_MISMATCH'],
  ] as const)('refuses %s', async (_label, overrides, code) => {
    await expect(issue(overrides)).rejects.toThrow(code);
    expect(await gate(A.company)).toEqual([]);
  });

  it('leaves no state row behind when the generation read names an unknown company (#1223 item 1)', async () => {
    await expect(
      dispatcher`SELECT * FROM public.current_commission_coverage_generation(${'01980000-0000-7000-8000-0000000000fe'}::uuid, ${STATE_ID}::uuid)`,
    ).rejects.toThrow('COVERAGE_COMPANY_NOT_FOUND');

    const [row] = await owner`SELECT count(*)::int AS n FROM commission_coverage_state WHERE company_id = ${'01980000-0000-7000-8000-0000000000fe'}`;
    expect(row?.['n']).toBe(0);
  });

  it('refuses a company that does not exist', async () => {
    await expect(
      issue({ company: '01980000-0000-7000-8000-0000000000ff' }),
    ).rejects.toThrow('COVERAGE_COMPANY_NOT_FOUND');
  });

  it('refuses while a counted event has no consumption mark, and accepts once it has one', async () => {
    await seedEvent(A.company, eventId(1), 'SalaryChanged');

    await expect(issue()).rejects.toThrow('COVERAGE_UNMARKED_EVENTS');

    await markEvent(A.company, eventId(1));
    expect(await issue({ reportThrough: eventId(1) })).toBe(1);
  });

  it('refuses a report bound that is ahead of the newest counted event', async () => {
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    await markEvent(A.company, eventId(1));

    await expect(issue({ reportThrough: eventId(9) })).rejects.toThrow('COVERAGE_REPORT_BOUND_AHEAD');
  });

});

describe('the bounds of an issuance (#1223 items 2 and 13)', () => {
  beforeEach(ensureState.bind(null, A.company));

  it('issues for a company with no counted events, storing both bounds as NULL (#1223 item 2)', async () => {
    expect(await issue()).toBe(1);

    const [proof] = await owner`SELECT report_through_id, verified_through_id FROM commission_coverage_proofs`;
    expect(proof).toEqual({ report_through_id: null, verified_through_id: null });
  });

  it('stores the function bound when the report printed none and marked events arrived since (#1223 item 2)', async () => {
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    await markEvent(A.company, eventId(1));

    expect(await issue({ reportThrough: null })).toBe(1);

    const [proof] = await owner`SELECT report_through_id, verified_through_id FROM commission_coverage_proofs`;
    expect(proof).toEqual({ report_through_id: null, verified_through_id: eventId(1) });
  });

  it('refuses a report bound when no counted event remains (#1223 item 2)', async () => {
    await expect(issue({ reportThrough: eventId(1) })).rejects.toThrow('COVERAGE_REPORT_BOUND_AHEAD');
  });

  it('reports a moved tip bound as such, never masked by the scope refusal (#1223 item 13)', async () => {
    await expect(
      issue({ tipFrom: '2020-01-01', verifiedBound: '2020-01-02', tipTo: '2020-01-02' }),
    ).rejects.toThrow(
      'COVERAGE_TIP_BOUND_MOVED',
    );
  });

  it('lets exactly one of two issuers on the same generation win', async () => {
    const results = await Promise.allSettled([issue(), issue()]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter(
        (r) => r.status === 'rejected' && /COVERAGE_GENERATION_MOVED/.test(String(r.reason)),
      ),
    ).toHaveLength(1);
  });
});

describe('the invalidation', () => {
  it('makes the current proof not current, keeps it stored, and allows the next issuance', async () => {
    await ensureState(A.company);
    await issue();

    const bumped = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${A.company}, true)`;
      return tx`SELECT public.invalidate_commission_coverage(${STATE_ID}::uuid, 'SOURCE_WRITE')::text AS generation`;
    });

    expect(bumped[0]?.['generation']).toBe('2');
    expect(await gate(A.company)).toEqual([]);
    expect(await issue({ generation: 2 })).toBe(3);
    const [kept] = await owner`SELECT count(*)::int AS n FROM commission_coverage_proofs`;
    expect(kept?.['n']).toBe(2);
  });

  it('refuses a reason that is not an upper-case code', async () => {
    await expect(
      app.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${A.company}, true)`;
        await tx`SELECT public.invalidate_commission_coverage(${STATE_ID}::uuid, 'drop table')`;
      }),
    ).rejects.toThrow('COVERAGE_REASON_INVALID');
  });

  it('is refused without a tenant context', async () => {
    await expect(
      app`SELECT public.invalidate_commission_coverage(${STATE_ID}::uuid, 'SOURCE_WRITE')`,
    ).rejects.toThrow('TENANT_CONTEXT_MISSING');
  });
});

describe('who may call which function', () => {
  it('lets the app role call only the gate and the invalidator, and the dispatcher only the issuer pair', async () => {
    const rows = await owner<{ role: string; fn: string; can: boolean }[]>`
      SELECT r AS role, f AS fn, has_function_privilege(r, f, 'EXECUTE') AS can
      FROM unnest(ARRAY['pospay_app', 'pospay_dispatcher', 'pospay_auth']) AS r,
        unnest(ARRAY[
          'public.read_commission_coverage_gate(uuid)',
          'public.invalidate_commission_coverage(uuid, text)',
          'public.current_commission_coverage_generation(uuid, uuid)',
          'public.issue_commission_coverage_proof(uuid, uuid, bigint, integer, uuid[], date, date, date, uuid, text, bigint, text, text)'
        ]) AS f`;

    const allowed = rows.filter((row) => row.can).map((row) => `${row.role} ${row.fn.split('(')[0]}`);

    expect(allowed.sort()).toEqual(
      [
        'pospay_app public.invalidate_commission_coverage',
        'pospay_app public.read_commission_coverage_gate',
        'pospay_dispatcher public.current_commission_coverage_generation',
        'pospay_dispatcher public.issue_commission_coverage_proof',
      ].sort(),
    );
  });
});
