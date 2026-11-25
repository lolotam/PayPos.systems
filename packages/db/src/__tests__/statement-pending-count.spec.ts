import { COMMISSION_INPUT_EVENT_TYPES, COMMISSION_INPUTS_CONSUMER_ID } from '@pospay/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closePendingCountTest,
  eventId,
  pendingCountHarness,
} from '../../test/statement-pending-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

// ADR-0012 §4 المجموعات 2 و3 و4 (CM-39): عدّاد الأحداث المعلّقة يُختبر بالأدوار الفعلية لا بجدول الكتالوج وحده.
// الدور والـ ACL والسياسات في statement-pending-count-role.spec.ts، والتداخل بين المعاملات في ...-isolation.spec.ts، والخطة في ...-plan.spec.ts.
const { A, B } = TENANT;
const FN = 'public.statement_pending_commission_events(timestamptz)';

let test: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;
const { asApp, pending, seedEvent, markEvent, clean } = pendingCountHarness(
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
});

describe('group 3: delivery states', () => {
  // حالات التسليم الفعلية: الحالة في أعمدة outbox لا تغيّر العدّ، فالذي يفرّق صفًا عن آخر هو علامة الاستهلاك وحدها.
  it.each([
    { name: 'published but not yet marked', options: { publishedAt: '2026-01-02T00:00:00Z' } },
    {
      name: 'parked after the last failed attempt',
      options: { parked: true, attempts: 5, lastError: 'CONSUMER_FAILED' },
    },
    {
      name: 'waiting out a retry backoff',
      options: { attempts: 2, lastError: 'CONSUMER_FAILED', nextAttemptAt: '2099-01-01T00:00:00Z' },
    },
    { name: 'held under a delivery lease', options: { nextAttemptAt: '2099-01-01T00:00:00Z' } },
  ])('counts a row $name until its mark exists', async ({ options }) => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SessionTipsChanged', options);

    expect(await asApp(A.company, (tx) => pending(tx))).toBe('1');

    await markEvent(A.company, eventId(1));

    expect(await asApp(A.company, (tx) => pending(tx))).toBe('0');
  });

  it('does not count an unpublished row once its mark is recorded', async () => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SessionTipsChanged');
    await markEvent(A.company, eventId(1));

    expect(await asApp(A.company, (tx) => pending(tx))).toBe('0');
  });

  // الحدث الأحدث لنفس الـ aggregate لا يفرّغ الأقدم؛ الأقدم يبقى معلّقًا إلى أن تُسجَّل علامته هو.
  it('keeps a stale-revision event pending until its own mark is recorded', async () => {
    await clean();
    const aggregateId = eventId(900);
    await seedEvent(A.company, eventId(1), 'SalaryChanged', {
      aggregateId,
      payload: { revision: 1 },
    });
    await seedEvent(A.company, eventId(2), 'SalaryChanged', {
      aggregateId,
      payload: { revision: 2 },
    });
    await markEvent(A.company, eventId(2));

    expect(await asApp(A.company, (tx) => pending(tx))).toBe('1');

    await markEvent(A.company, eventId(1));

    expect(await asApp(A.company, (tx) => pending(tx))).toBe('0');
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
    // حدثان حقيقيان: واحد معلَّم وواحد غير معلَّم. جدولا pg_temp فارغان، فلو وصلت الدالة إلى consumed_events المؤقت لحسبت الاثنين (2) لا واحدًا.
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    await seedEvent(A.company, eventId(2), 'SalaryChanged');
    await markEvent(A.company, eventId(2));

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
