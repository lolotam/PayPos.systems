import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClusterRoleLock } from '../../test/role-lock.ts';
import {
  closePendingCountTest,
  eventId,
  pendingCountHarness,
  type Tx,
} from '../../test/statement-pending-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

// ADR-0012 §4 المجموعة 1 (CM-39): الدور ومنحه وقائمة تنفيذ الدالة وسياسات RLS تُختبر بالأدوار الفعلية.
// قراءات الدور (صفاته وعضوياته) عالمية على مستوى الـ cluster، فتحت القفل المشترك كي لا يغيّرها اختبار يعدّلها في تشغيلة أخرى.
const { A, B } = TENANT;
const FN = 'public.statement_pending_commission_events(timestamptz)';
const ROLE = 'pospay_approval_reader';
const OTHER_RUNTIME_ROLES = [
  'pospay_auth',
  'pospay_dispatcher',
  'pospay_notifications',
  'pospay_suppression_reader',
];
const ALLOWED_COLUMNS: Record<string, string[]> = {
  outbox: ['company_id', 'created_at', 'event_type', 'id'],
  consumed_events: ['company_id', 'consumer_id', 'event_id'],
};

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

afterAll(async () => closePendingCountTest(test, owner, app));

/** يقرأ الجداول كما يراها الدور نفسه: نفس صلاحيات الأعمدة وسياسات RLS، بسياق شركة أو بلا سياق. */
async function asReader<T>(company: string | null, run: (tx: Tx) => Promise<T>): Promise<T> {
  return owner.begin(async (tx) => {
    await tx`SET LOCAL ROLE pospay_approval_reader`;
    if (company !== null) await tx`SELECT set_config('app.company_id', ${company}, true)`;
    return run(tx);
  }) as Promise<T>;
}

describe('group 1: the role (effective privileges)', () => {
  it('has every ADR-0012 §2 attribute and is a member of nothing, with no members', async () => {
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
});

describe('group 1: what the role owns', () => {
  it('owns exactly this function and nothing else, with USAGE, no CREATE on schema or database, and PUBLIC-default TEMP', async () => {
    const [owned] = await withClusterRoleLock(
      'shared',
      () => owner`SELECT
      (SELECT array_agg(proname) FROM pg_proc WHERE proowner = r.oid) AS functions,
      (SELECT count(*) FROM pg_class WHERE relowner = r.oid)::int AS relations,
      (SELECT count(*) FROM pg_namespace WHERE nspowner = r.oid)::int AS schemas,
      has_schema_privilege(r.oid, 'public', 'USAGE') AS usage,
      has_schema_privilege(r.oid, 'public', 'CREATE') AS create_privilege,
      has_database_privilege(r.oid, current_database(), 'CREATE') AS db_create,
      has_database_privilege(r.oid, current_database(), 'TEMP') AS db_temp,
      has_function_privilege(r.oid, 'public.app_company_id()', 'EXECUTE') AS helper
      FROM pg_roles r WHERE r.rolname = ${ROLE}`,
    );

    expect(owned).toEqual({
      functions: ['statement_pending_commission_events'],
      relations: 0,
      schemas: 0,
      usage: true,
      create_privilege: false,
      db_create: false,
      db_temp: true,
      helper: true,
    });
  });

  it('can SELECT only the four outbox and three consumed_events columns, with no write path', async () => {
    for (const [table, allowed] of Object.entries(ALLOWED_COLUMNS)) {
      const columns = await withClusterRoleLock(
        'shared',
        () => owner`SELECT column_name, has_column_privilege(${ROLE}, ${`public.${table}`},
        column_name, 'SELECT') AS can_select, has_column_privilege(${ROLE}, ${`public.${table}`},
        column_name, 'INSERT,UPDATE,REFERENCES') AS can_write
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`,
      );
      expect(
        columns
          .filter((c) => c['can_select'])
          .map((c) => c['column_name'])
          .sort(),
      ).toEqual(allowed);
      expect(columns.some((c) => c['can_write'])).toBe(false);
    }
  });
});

describe('group 1: the role column and table grants', () => {
  // الأعمدة وحدها لا تكفي: DELETE أو TRUNCATE أو TRIGGER على الجدول كله، أو USAGE على sequence، يمرّ من اختبار الأعمدة.
  it('holds no table-level privilege and no sequence privilege on any relation', async () => {
    const reachable = await withClusterRoleLock(
      'shared',
      () => owner`SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND ((c.relkind <> 'S' AND has_table_privilege(${ROLE}, c.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
          OR (c.relkind = 'S' AND has_sequence_privilege(${ROLE}, c.oid, 'USAGE,SELECT,UPDATE')))`,
    );
    const writable = await withClusterRoleLock(
      'shared',
      () => owner`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'S') AND c.relname NOT IN ('outbox', 'consumed_events')
        AND has_any_column_privilege(${ROLE}, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')`,
    );

    expect(reachable).toEqual([]);
    expect(writable).toEqual([]);
  });
});

describe('group 1: the function ACL and the RLS policies', () => {
  it('is SECURITY DEFINER, STABLE, NOT LEAKPROOF with the pinned path and row_security on', async () => {
    const [fn] = await owner`SELECT p.prosecdef, p.provolatile, p.proleakproof, p.proconfig,
      pg_get_userbyid(p.proowner) AS owner, p.prorettype::regtype::text AS returns, p.pronargs
      FROM pg_proc p WHERE p.oid = ${FN}::regprocedure`;

    expect(fn).toMatchObject({
      prosecdef: true,
      provolatile: 's',
      proleakproof: false,
      owner: ROLE,
      returns: 'bigint',
      pronargs: 1,
    });
    expect([...(fn?.['proconfig'] as string[])].sort()).toEqual([
      'row_security=on',
      'search_path=pg_catalog, pg_temp',
    ]);
  });

  // قائمة التنفيذ كلها لا أسماء مختارة فقط: أي مستفيد إضافي (PUBLIC أو دور آخر أو WITH GRANT OPTION) يفشل هنا.
  it('has exactly two EXECUTE entries, for the owner and for pospay_app, and nothing else', async () => {
    const acl =
      await owner`SELECT coalesce(r.rolname, 'PUBLIC') AS grantee, x.privilege_type AS privilege,
      x.is_grantable AS grantable
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      LEFT JOIN pg_roles r ON r.oid = x.grantee
      WHERE p.oid = ${FN}::regprocedure ORDER BY 1`;
    const executes = async (role: string) =>
      (await owner`SELECT has_function_privilege(${role}, ${FN}, 'EXECUTE') AS ok`)[0]?.['ok'];

    expect(acl).toEqual([
      { grantee: 'pospay_app', privilege: 'EXECUTE', grantable: false },
      { grantee: ROLE, privilege: 'EXECUTE', grantable: false },
    ]);
    for (const role of OTHER_RUNTIME_ROLES)
      expect(await withClusterRoleLock('shared', () => executes(role))).toBe(false);
  });
});

describe('group 1: the RLS policies', () => {
  it('keeps RLS enabled and forced on both tables', async () => {
    const tables = await owner`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('outbox', 'consumed_events') AND relnamespace = 'public'::regnamespace ORDER BY relname`;

    expect(tables.map((t) => [t['relrowsecurity'], t['relforcerowsecurity']])).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  // السياسة بنفس الشرط لكن لـ PUBLIC أو لدور آخر تمرّ من فحص الشرط وحده؛ لذلك يُفحص المستفيد والأمر وغياب أي سياسة أخرى.
  it('targets exactly the role in each SELECT policy, and no other policy reaches the role or PUBLIC', async () => {
    const policies = await owner`SELECT tablename, policyname, cmd, permissive, qual, with_check,
      array_to_string(roles, ',') AS roles FROM pg_policies WHERE policyname LIKE '%approval_reader%'
      ORDER BY tablename`;
    const reaching =
      await owner`SELECT c.relname, p.polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relname IN ('outbox', 'consumed_events')
        AND (0 = ANY (p.polroles) OR (SELECT oid FROM pg_roles WHERE rolname = ${ROLE}) = ANY (p.polroles))
      ORDER BY 1`;

    expect(policies).toEqual([
      {
        tablename: 'consumed_events',
        policyname: 'consumed_events_approval_reader_select',
        cmd: 'SELECT',
        permissive: 'PERMISSIVE',
        qual: '(company_id = app_company_id())',
        with_check: null,
        roles: ROLE,
      },
      {
        tablename: 'outbox',
        policyname: 'outbox_approval_reader_select',
        cmd: 'SELECT',
        permissive: 'PERMISSIVE',
        qual: '(company_id = app_company_id())',
        with_check: null,
        roles: ROLE,
      },
    ]);
    expect(reaching.map((r) => r['polname'])).toEqual([
      'consumed_events_approval_reader_select',
      'outbox_approval_reader_select',
    ]);
  });

  it('cannot be assumed by pospay_app, and pospay_app still cannot read the outbox directly', async () => {
    await expect(app`SET ROLE pospay_approval_reader`).rejects.toThrow(/permission denied/);
    await expect(app.begin((tx) => tx`SELECT id FROM outbox`)).rejects.toThrow(/permission denied/);
  });
});

describe('group 1: what the role itself can read (RLS applied)', () => {
  it('sees only its own tenant rows and only the granted columns, with no rows without a context', async () => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    await seedEvent(B.company, eventId(2), 'SalaryChanged');
    await markEvent(A.company, eventId(1));
    await markEvent(B.company, eventId(2));

    const outboxA = await asReader(A.company, (tx) => tx`SELECT company_id, id FROM outbox`);
    const marksB = await asReader(
      B.company,
      (tx) => tx`SELECT company_id, event_id FROM consumed_events`,
    );
    const withoutContext = await asReader(null, (tx) => tx`SELECT count(*)::int AS n FROM outbox`);

    expect(outboxA).toEqual([{ company_id: A.company, id: eventId(1) }]);
    expect(marksB).toEqual([{ company_id: B.company, event_id: eventId(2) }]);
    expect(withoutContext).toEqual([{ n: 0 }]);
    await expect(asReader(A.company, (tx) => tx`SELECT payload FROM outbox`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('cannot write or delete in either table', async () => {
    for (const statement of [
      `INSERT INTO consumed_events (company_id, consumer_id, event_id) VALUES ('${A.company}', 'x', '${eventId(3)}')`,
      `UPDATE outbox SET event_type = 'X'`,
      `DELETE FROM outbox`,
      `TRUNCATE outbox`,
    ])
      await expect(asReader(A.company, (tx) => tx.unsafe(statement))).rejects.toThrow(
        /permission denied/,
      );
  });
});
