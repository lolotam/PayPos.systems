import {
  COMMISSION_COVERAGE_PROOF_VERSION,
  COMMISSION_INPUT_EVENT_TYPES,
  COMMISSION_INPUTS_CONSUMER_ID,
} from '@pospay/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { asReplicaOwner } from '../../test/owner-cleanup.ts';
import { withClusterRoleLock } from '../../test/role-lock.ts';
import { eventId, pendingCountHarness } from '../../test/statement-pending-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

// ADR-0054 (إضافة 2026-11-22) §1 و§2 و§5: الدور وملكيته ومنحه، وتريغرات الرفض، وتكافؤ الثوابت مع الملف التنفيذي.
const { A } = TENANT;
const ROLE = 'pospay_coverage_issuer';
const OWNED_FUNCTIONS = [
  'commission_coverage_required_version',
  'current_commission_coverage_generation',
  'invalidate_commission_coverage',
  'issue_commission_coverage_proof',
  'read_commission_coverage_gate',
  'refuse_commission_coverage_change',
  'refuse_counted_outbox_delete',
  'refuse_outbox_truncate',
];
const TABLES = ['commission_coverage_state', 'commission_coverage_proofs'];

let test: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;
const { seedEvent, markEvent, clean } = pendingCountHarness(
  () => owner,
  () => app,
);

beforeAll(async () => {
  test = await createTestDatabase();
  await seedTwoTenants(test.ownerUrl);
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  app = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await app.end();
  await owner.end();
  await test.drop();
});

beforeEach(clean);

describe('the issuer role', () => {
  it('has every attribute of ADR-0054 §1, is a member of nothing and has no members', async () => {
    const [role, links] = await withClusterRoleLock('shared', async () => [
      (
        await owner`SELECT rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreatedb,
        rolcreaterole, rolreplication FROM pg_roles WHERE rolname = ${ROLE}`
      )[0],
      await owner`SELECT 1 FROM pg_auth_members a JOIN pg_roles r ON r.oid IN (a.roleid, a.member)
        WHERE r.rolname = ${ROLE}`,
    ]);

    expect(role).toEqual({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    });
    expect(links).toHaveLength(0);
  });

  it('owns exactly the eight coverage functions and no table, with no CREATE on the schema', async () => {
    const [owned] = await withClusterRoleLock(
      'shared',
      () => owner`SELECT
      (SELECT array_agg(proname ORDER BY proname) FROM pg_proc WHERE proowner = r.oid) AS functions,
      (SELECT count(*) FROM pg_class WHERE relowner = r.oid)::int AS relations,
      has_schema_privilege(r.oid, 'public', 'CREATE') AS create_privilege
      FROM pg_roles r WHERE r.rolname = ${ROLE}`,
    );

    expect(owned).toEqual({ functions: OWNED_FUNCTIONS, relations: 0, create_privilege: false });
  });

  it('is not reachable by the application: SET ROLE is refused and neither table is readable', async () => {
    await expect(app`SET ROLE pospay_coverage_issuer`).rejects.toThrow(/permission denied/);
    for (const table of TABLES) {
      await expect(app.begin((tx) => tx.unsafe(`SELECT 1 FROM ${table}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe('tenant isolation of the issuer role (CLAUDE.md section 5)', () => {
  beforeEach(async () => {
    await asReplicaOwner(owner, async (tx) => {
      await tx`DELETE FROM commission_coverage_proofs`;
      await tx`DELETE FROM commission_coverage_state`;
    });
  });

  it.each(TABLES)('reads no %s row of another company, with or without a tenant context', async (table) => {
    await seedProofRow();
    const read = (company: string | null) =>
      owner.begin(async (tx) => {
        await tx`SET LOCAL ROLE pospay_coverage_issuer`;
        if (company !== null) await tx`SELECT set_config('app.company_id', ${company}, true)`;
        return tx.unsafe(`SELECT company_id FROM ${table}`);
      });

    expect((await read(TENANT.B.company)).length).toBe(0);
    expect((await read(null)).length).toBe(0);
    expect((await read(A.company)).length).toBe(1);
  });

  it('cannot write a row of another company even with its own context set to that company', async () => {
    await expect(
      owner.begin(async (tx) => {
        await tx`SET LOCAL ROLE pospay_coverage_issuer`;
        await tx`SELECT set_config('app.company_id', ${TENANT.B.company}, true)`;
        await tx`INSERT INTO commission_coverage_state (company_id, id) VALUES (${A.company}, ${eventId(600)})`;
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('the tables', () => {
  it.each(TABLES)('%s has row-level security enabled and forced, with no policy for PUBLIC or the app', async (table) => {
    const [flags] = await owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = ${table}`;
    const reaching = await owner`SELECT polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relname = ${table}
        AND (0 = ANY (p.polroles) OR (SELECT oid FROM pg_roles WHERE rolname = 'pospay_app') = ANY (p.polroles))`;

    expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(reaching).toEqual([]);
  });
});

async function seedProofRow(): Promise<void> {
  await owner`INSERT INTO commission_coverage_state (company_id, id) VALUES (${A.company}, ${eventId(500)})`;
  await owner`INSERT INTO commission_coverage_proofs (company_id, id, generation, version, business_ids,
      tip_from, tip_to, tip_day_bound, counted_types, consumer_id, database_name, system_id, run_id, release,
      issued_by) VALUES (${A.company}, ${eventId(501)}, 1, 1, ARRAY[${A.business}]::uuid[], '2026-01-01',
      '2026-12-31', '2026-12-31', ARRAY['SalaryChanged'], 'commissions.project-inputs', 'db', 1, 'run', 'rel', 'tester')`;
}

describe('the refusing triggers', () => {
  beforeEach(async () => {
    await asReplicaOwner(owner, async (tx) => {
      await tx`DELETE FROM commission_coverage_proofs`;
      await tx`DELETE FROM commission_coverage_state`;
    });
  });

  it.each([
    ['updating a proof', 'UPDATE commission_coverage_proofs SET run_id = $$x$$'],
    ['deleting a proof', 'DELETE FROM commission_coverage_proofs'],
    ['truncating the proofs', 'TRUNCATE commission_coverage_proofs'],
    ['deleting a state row', 'DELETE FROM commission_coverage_state'],
    ['truncating the state table', 'TRUNCATE commission_coverage_state CASCADE'],
  ])('refuses %s even for the owner', async (_label, statement) => {
    await seedProofRow();

    await expect(owner.unsafe(statement)).rejects.toThrow('COVERAGE_ROWS_ARE_APPEND_ONLY');
  });

  it('lets the state generation move, since invalidation is an update', async () => {
    await seedProofRow();

    await owner`UPDATE commission_coverage_state SET generation = generation + 1, reason = 'TEST'`;

    const [row] = await owner`SELECT generation::int AS generation FROM commission_coverage_state`;
    expect(row?.['generation']).toBe(1);
  });

  it('refuses deleting a counted outbox row, allows deleting any other, and refuses truncating the outbox', async () => {
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    await seedEvent(A.company, eventId(2), 'OrderCompleted');
    await markEvent(A.company, eventId(1));

    await expect(owner`DELETE FROM outbox WHERE id = ${eventId(1)}`).rejects.toThrow(
      'COUNTED_OUTBOX_DELETE_REFUSED',
    );
    await owner`DELETE FROM outbox WHERE id = ${eventId(2)}`;
    await expect(owner`TRUNCATE outbox`).rejects.toThrow('COUNTED_OUTBOX_DELETE_REFUSED');
  });

  it('is bypassed only by the owner session in replica mode, which the fixtures use to clean up', async () => {
    await seedEvent(A.company, eventId(3), 'PackageSaleChanged');

    await asReplicaOwner(owner, (tx) => tx`DELETE FROM outbox WHERE id = ${eventId(3)}`);

    const [row] = await owner`SELECT count(*)::int AS n FROM outbox WHERE id = ${eventId(3)}`;
    expect(row?.['n']).toBe(0);
  });
});

describe('parity with the approval binary', () => {
  it('requires the proof version the binary stamps and checks', async () => {
    const [row] = await owner`SELECT public.commission_coverage_required_version() AS version`;

    expect(row?.['version']).toBe(COMMISSION_COVERAGE_PROOF_VERSION);
  });

  it.each([
    'issue_commission_coverage_proof',
    'refuse_counted_outbox_delete',
    'statement_pending_commission_events',
  ])('%s lists exactly the counted event types of the worker', async (name) => {
    const [fn] = await owner`SELECT prosrc FROM pg_proc WHERE proname = ${name}`;
    const source = String(fn?.['prosrc']);
    const typed = [...source.matchAll(/'([A-Z][A-Za-z]+)'/g)]
      .map((match) => match[1] as string)
      .filter((literal) => !/^(COVERAGE|COUNTED|TENANT|APPROVAL)/.test(literal) && /[a-z]/.test(literal));

    expect([...new Set(typed)].sort()).toEqual([...COMMISSION_INPUT_EVENT_TYPES].sort());
  });

  it.each(['issue_commission_coverage_proof', 'statement_pending_commission_events'])(
    '%s names exactly the consumer id of the worker',
    async (name) => {
      const [fn] = await owner`SELECT prosrc FROM pg_proc WHERE proname = ${name}`;
      const source = String(fn?.['prosrc']);
      const consumers = [...source.matchAll(/'(commissions.[a-z-]+)'/g)].map((match) => match[1] as string);

      expect([...new Set(consumers)]).toEqual([COMMISSION_INPUTS_CONSUMER_ID]);
    },
  );
});
