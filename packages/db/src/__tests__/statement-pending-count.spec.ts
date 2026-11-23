import { COMMISSION_INPUT_EVENT_TYPES, COMMISSION_INPUTS_CONSUMER_ID } from '@pospay/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

// ADR-0012 §4 المجموعات 1 و2 و3 و4 و7 (CM-39): عدّاد الأحداث المعلّقة يُختبر بالأدوار الفعلية لا بجدول الكتالوج وحده.
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
const eventId = (n: number): string => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

let test: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;
type Tx = postgres.TransactionSql;

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

/** يشغّل معاملة كـ pospay_app بسياق الشركة؛ null يعني بلا سياق، كأن الاتصال رجع من الـ pool نظيفًا. */
async function asApp<T>(company: string | null, run: (tx: Tx) => Promise<T>): Promise<T> {
  return app.begin(async (tx) => {
    if (company !== null) await tx`SELECT set_config('app.company_id', ${company}, true)`;
    return run(tx);
  }) as Promise<T>;
}

/**
 * يقرأ توقيت المعاملة نصًا بلا فقد دقة ثم يستدعي العدّاد به، كما يجب أن يفعل محوّل الاعتماد.
 * المعامل نصّ ثم يُحوَّل في SQL: معامل من نوع timestamptz يمرّ في السائق عبر Date فيقص الميكروثواني.
 */
async function pending(tx: Tx, cutoff?: string | null): Promise<string> {
  const [clock] = await tx`SELECT transaction_timestamp()::text AS ts`;
  const used = cutoff === undefined ? (clock?.['ts'] as string) : cutoff;
  const [row] =
    await tx`SELECT public.statement_pending_commission_events(${used}::text::timestamptz)::text AS n`;
  return row?.['n'] as string;
}

async function seedEvent(
  company: string,
  id: string,
  type: string,
  options: { createdAt?: string; publishedAt?: string | null; parked?: boolean } = {},
): Promise<void> {
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload,
      created_at, published_at, parked_at)
    VALUES (${company}, ${id}, 'service_session', ${id}, ${type}, '{}'::jsonb,
      ${options.createdAt ?? '2026-01-01T00:00:00Z'}::timestamptz, ${options.publishedAt ?? null},
      ${options.parked === true ? '2026-01-02T00:00:00Z' : null})`;
}

const markEvent = (company: string, id: string, consumer = COMMISSION_INPUTS_CONSUMER_ID) =>
  owner`INSERT INTO consumed_events (company_id, consumer_id, event_id) VALUES (${company}, ${consumer}, ${id})`;

async function clean(): Promise<void> {
  await owner`DELETE FROM consumed_events`;
  await owner`DELETE FROM outbox`;
}

describe('group 1: the role and its grants (effective privileges)', () => {
  it('the role has every ADR-0012 §2 attribute and is a member of nothing, with no members', async () => {
    const [role] = await owner`SELECT rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreatedb,
      rolcreaterole, rolreplication FROM pg_roles WHERE rolname = ${ROLE}`;
    const links =
      await owner`SELECT 1 FROM pg_auth_members a JOIN pg_roles r ON r.oid IN (a.roleid, a.member)
      WHERE r.rolname = ${ROLE}`;

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

  it('owns exactly this function and nothing else, with USAGE but no CREATE on the schema', async () => {
    const [owned] = await owner`SELECT
      (SELECT array_agg(proname) FROM pg_proc WHERE proowner = r.oid) AS functions,
      (SELECT count(*) FROM pg_class WHERE relowner = r.oid)::int AS relations,
      (SELECT count(*) FROM pg_namespace WHERE nspowner = r.oid)::int AS schemas,
      has_schema_privilege(r.oid, 'public', 'USAGE') AS usage,
      has_schema_privilege(r.oid, 'public', 'CREATE') AS create_privilege,
      has_function_privilege(r.oid, 'public.app_company_id()', 'EXECUTE') AS helper
      FROM pg_roles r WHERE r.rolname = ${ROLE}`;

    expect(owned).toEqual({
      functions: ['statement_pending_commission_events'],
      relations: 0,
      schemas: 0,
      usage: true,
      create_privilege: false,
      helper: true,
    });
  });

  it('can SELECT only the four outbox and three consumed_events columns, and nothing else anywhere', async () => {
    for (const [table, allowed] of Object.entries(ALLOWED_COLUMNS)) {
      const columns =
        await owner`SELECT column_name, has_column_privilege(${ROLE}, ${`public.${table}`},
        column_name, 'SELECT') AS can_select, has_column_privilege(${ROLE}, ${`public.${table}`},
        column_name, 'INSERT,UPDATE,REFERENCES') AS can_write
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`;
      expect(
        columns
          .filter((c) => c['can_select'])
          .map((c) => c['column_name'])
          .sort(),
      ).toEqual(allowed);
      expect(columns.some((c) => c['can_write'])).toBe(false);
    }
    const reachable =
      await owner`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'S') AND c.relname NOT IN ('outbox', 'consumed_events')
        AND has_any_column_privilege(${ROLE}, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')`;
    expect(reachable).toHaveLength(0);
  });
});

describe('group 1: the function, its ACL and the RLS policies', () => {
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

  it('only pospay_app executes it; PUBLIC and the other runtime roles do not', async () => {
    const [fn] =
      await owner`SELECT p.proacl::text AS acl FROM pg_proc p WHERE p.oid = ${FN}::regprocedure`;
    const executes = async (role: string) =>
      (await owner`SELECT has_function_privilege(${role}, ${FN}, 'EXECUTE') AS ok`)[0]?.['ok'];

    expect(await executes('pospay_app')).toBe(true);
    for (const role of OTHER_RUNTIME_ROLES) expect(await executes(role)).toBe(false);
    expect(fn?.['acl']).not.toMatch(/(^\{|,)=X\//);
  });

  it('keeps RLS enabled and forced on both tables, with a tenant-only SELECT policy for the role', async () => {
    const tables = await owner`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('outbox', 'consumed_events') AND relnamespace = 'public'::regnamespace ORDER BY relname`;
    const policies = await owner`SELECT tablename, cmd, qual FROM pg_policies
      WHERE policyname LIKE '%approval_reader%' ORDER BY tablename`;

    expect(tables.map((t) => [t['relrowsecurity'], t['relforcerowsecurity']])).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(policies.map((p) => [p['tablename'], p['cmd'], p['qual']])).toEqual([
      ['consumed_events', 'SELECT', '(company_id = app_company_id())'],
      ['outbox', 'SELECT', '(company_id = app_company_id())'],
    ]);
  });

  it('cannot be assumed by pospay_app, and pospay_app still cannot read the outbox directly', async () => {
    await expect(app`SET ROLE pospay_approval_reader`).rejects.toThrow(/permission denied/);
    await expect(asApp(A.company, (tx) => tx`SELECT id FROM outbox`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asApp(A.company, (tx) => tx`SELECT event_id FROM consumed_events`),
    ).resolves.toBeDefined();
  });
});

describe('group 2: the tenant context and the cutoff', () => {
  it('refuses a missing context even when the tables are empty, and a malformed one', async () => {
    await clean();

    await expect(asApp(null, (tx) => pending(tx))).rejects.toThrow('TENANT_CONTEXT_MISSING');
    await expect(asApp('not-a-uuid', (tx) => pending(tx))).rejects.toThrow(
      /invalid input syntax for type uuid/,
    );
  });

  it.each([
    { name: 'NULL', cutoff: null },
    { name: 'an old timestamp', cutoff: '2020-01-01 00:00:00+00' },
    { name: 'a future timestamp', cutoff: '2099-01-01 00:00:00+00' },
  ])('refuses $name as the cutoff', async ({ cutoff }) => {
    await expect(asApp(A.company, (tx) => pending(tx, cutoff))).rejects.toThrow(
      'APPROVAL_CUTOFF_INVALID',
    );
  });

  // العلّة التي كشفها الاختبار: سائق postgres.js يمرّر معامل timestamptz عبر Date فيقص الميكروثواني، فترفضه الدالة.
  it('refuses the transaction timestamp when it is truncated to milliseconds, as a JS Date would', async () => {
    // قيمة المعاملة نفسها تُقصّ إلى ميلي ثانية؛ في احتمال ضئيل تكون مقسومة على 1000 ميكروثانية فنعيد المحاولة بمعاملة أخرى.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const outcome = await asApp(A.company, async (tx) => {
        const [clock] = await tx`SELECT transaction_timestamp()::text AS exact,
          date_trunc('milliseconds', transaction_timestamp())::text AS truncated`;
        if (clock?.['exact'] === clock?.['truncated']) return 'aligned';
        await tx`SELECT public.statement_pending_commission_events(${clock?.['truncated'] as string}::text::timestamptz)`;
        return 'accepted';
      }).catch((error: unknown) => error);

      if (outcome === 'aligned') continue;
      expect(outcome).toMatchObject({ message: 'APPROVAL_CUTOFF_INVALID' });
      return;
    }
    throw new Error('the transaction timestamp stayed millisecond-aligned for 25 transactions');
  });

  it('never counts another tenant, even with the same event id, across pooled A, B and no-context calls', async () => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    await seedEvent(B.company, eventId(1), 'SalaryChanged');
    await seedEvent(B.company, eventId(2), 'SalaryChanged');

    expect(await asApp(A.company, (tx) => pending(tx))).toBe('1');
    expect(await asApp(B.company, (tx) => pending(tx))).toBe('2');
    await expect(asApp(null, (tx) => pending(tx))).rejects.toThrow('TENANT_CONTEXT_MISSING');
    expect(await asApp(A.company, (tx) => pending(tx))).toBe('1');
  });
});

describe('group 3: the predicate', () => {
  it('counts one pending row of each of the six types and none of a non-counted type', async () => {
    await clean();
    for (const [index, type] of COMMISSION_INPUT_EVENT_TYPES.entries())
      await seedEvent(A.company, eventId(index + 1), type);
    await seedEvent(A.company, eventId(90), 'OrderCompleted');

    expect(await asApp(A.company, (tx) => pending(tx))).toBe(
      String(COMMISSION_INPUT_EVENT_TYPES.length),
    );
  });

  it('the installed function lists exactly the six types and the consumer id of packages/domain', async () => {
    const [fn] = await owner`SELECT pg_get_functiondef(${FN}::regprocedure) AS def`;
    const definition = fn?.['def'] as string;
    const quoted = [...definition.matchAll(/'([A-Za-z][A-Za-z0-9.-]+)'/g)].map((match) => match[1]);

    expect(quoted.filter((name) => /^[A-Z]/.test(name ?? '')).sort()).toEqual(
      [...COMMISSION_INPUT_EVENT_TYPES].sort(),
    );
    expect(quoted).toContain(COMMISSION_INPUTS_CONSUMER_ID);
  });

  it('discharges only a commit mark of this consumer for this company', async () => {
    await clean();
    for (let n = 1; n <= 4; n += 1) await seedEvent(A.company, eventId(n), 'SalaryChanged');
    await markEvent(A.company, eventId(1));
    await markEvent(A.company, eventId(2), 'commissions.other-consumer');
    await markEvent(B.company, eventId(3));

    expect(await asApp(A.company, (tx) => pending(tx))).toBe('3');
  });

  it('counts published-unmarked, parked and retried rows, and not an unpublished but marked row', async () => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SessionTipsChanged', {
      publishedAt: '2026-01-02T00:00:00Z',
    });
    await seedEvent(A.company, eventId(2), 'SessionTipsChanged', { parked: true });
    await seedEvent(A.company, eventId(3), 'SessionTipsChanged');
    await markEvent(A.company, eventId(3));

    expect(await asApp(A.company, (tx) => pending(tx))).toBe('2');
  });
});

describe('group 3: the cutoff and the result type', () => {
  it('counts only rows created strictly before the cutoff', async () => {
    await clean();
    const counted = await asApp(A.company, async (tx) => {
      const insert = (
        n: number,
        shift: string,
      ) => tx`INSERT INTO outbox (company_id, id, aggregate_type,
        aggregate_id, event_type, payload, created_at) VALUES (${A.company}, ${eventId(n)}, 'service_session',
        ${eventId(n)}, 'SalaryChanged', '{}'::jsonb, transaction_timestamp() + ${shift}::interval)`;
      await insert(1, '-1 microsecond');
      await insert(2, '0 microseconds');
      await insert(3, '1 microsecond');
      return pending(tx);
    });

    expect(counted).toBe('1');
  });

  it('returns a bigint scalar', async () => {
    const [row] = await asApp(
      A.company,
      (tx) => tx`SELECT pg_typeof(public.statement_pending_commission_events(
      transaction_timestamp())) AS type`,
    );

    expect(row?.['type']).toBe('bigint');
  });
});

describe('group 4: search-path attacks', () => {
  it('shadowing outbox, consumed_events and the helper in pg_temp cannot redirect or widen the read', async () => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SalaryChanged');

    const counted = await asApp(A.company, async (tx) => {
      await tx`CREATE TEMP TABLE outbox (company_id uuid, id uuid, event_type text, created_at timestamptz)`;
      await tx`CREATE TEMP TABLE consumed_events (company_id uuid, consumer_id text, event_id uuid)`;
      await tx.unsafe(
        `CREATE FUNCTION pg_temp.app_company_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '${B.company}'::uuid $$`,
      );
      await tx`SET LOCAL search_path = pg_temp, public`;
      return pending(tx);
    });

    expect(counted).toBe('1');
  });
});

describe('group 7: result shape and plan on a large tenant', () => {
  it('counts a large tenant exactly and reads the counted types through an index', async () => {
    await clean();
    await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, created_at)
      SELECT c, gen_random_uuid(), 'order', gen_random_uuid(), 'OrderCompleted', '{}'::jsonb, '2026-01-01'
      FROM unnest(ARRAY[${A.company}, ${B.company}]::uuid[]) AS c, generate_series(1, 25000)`;
    await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, created_at)
      SELECT ${A.company}, gen_random_uuid(), 'service_session', gen_random_uuid(), 'ServiceLineChanged', '{}'::jsonb, '2026-01-01'
      FROM generate_series(1, 120)`;
    await owner`ANALYZE outbox`;

    expect(await asApp(A.company, (tx) => pending(tx))).toBe('120');

    const plan = await owner.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${A.company}, true)`;
      return tx.unsafe(`EXPLAIN (FORMAT TEXT) SELECT pg_catalog.count(*) FROM public.outbox o
        WHERE o.company_id = '${A.company}' AND o.created_at < now()
          AND o.event_type IN (${COMMISSION_INPUT_EVENT_TYPES.map((t) => `'${t}'`).join(',')})
          AND NOT EXISTS (SELECT 1 FROM public.consumed_events c WHERE c.company_id = o.company_id
            AND c.event_id = o.id AND c.consumer_id = '${COMMISSION_INPUTS_CONSUMER_ID}')`);
    });
    const text = plan.map((row) => Object.values(row)[0]).join('\n');

    expect(text).not.toMatch(/Seq Scan on outbox/);
    // الخطة الفعلية تختار الفهرس الجزئي outbox_commission_retained_replay_idx الأقدم لا الفهرس الجديد (انظر تقرير 53-1)؛
    // الشرط هنا أن القراءة فهرسية وبلا مسح تسلسلي، لا أن تختار فهرسًا بعينه.
    expect(text).toMatch(/Index (Only )?Scan using outbox_[a-z_]+ on outbox/);
  });
});
