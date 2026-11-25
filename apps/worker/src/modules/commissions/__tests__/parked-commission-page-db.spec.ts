import { COMMISSION_INPUT_EVENT_TYPES } from '@pospay/domain';
import postgres from 'postgres';
import { expect, it, vi } from 'vitest';

import {
  A,
  COUNTED,
  dispatcher,
  dispatcherUrl,
  eventId,
  freshSweep,
  owner,
  seedEvent,
} from './parked-commission-alert-db.fixture.ts';

const capture = vi.hoisted(() => ({
  enabled: false,
  statements: [] as { query: string; parameters: postgres.ParameterOrJSON<never>[] }[],
}));

// نختبر SQL الذي ينفذه المسار نفسه حتى لا تنجح نسخة اختبار قديمة بعد تغيير الاستعلام.
vi.mock('postgres', async (importOriginal) => {
  const original = await importOriginal<{ default: typeof postgres }>();
  return {
    ...original,
    default: (url: string, options: object) =>
      original.default(url, {
        ...options,
        debug: (
          _connection: number,
          query: string,
          parameters: postgres.ParameterOrJSON<never>[],
        ) => {
          if (capture.enabled && /SELECT[\s\S]*FROM outbox/.test(query))
            capture.statements.push({ query, parameters: [...parameters] });
        },
      }),
  };
});

it('reads the parked commission page without a payload column', async () => {
  const event = eventId(30);
  await seedEvent(A.company, event, COUNTED, { parked: true });
  const page = await dispatcher.commissionParkedEventPage('0', 100);
  const row = page.find((candidate) => candidate.id === event);
  expect(row).toBeDefined();
  expect('payload' in (row as unknown as Record<string, unknown>)).toBe(false);
  expect(Object.keys(row as unknown as Record<string, unknown>).sort()).toEqual([
    'companyId',
    'eventType',
    'id',
    'seq',
  ]);
});

it('refuses a cursor that is not a decimal number', async () => {
  await expect(dispatcher.commissionParkedEventPage('-1', 100)).rejects.toThrow(
    'PARKED_CURSOR_INVALID',
  );
  await expect(dispatcher.commissionParkedEventPage('1.5', 100)).rejects.toThrow(
    'PARKED_CURSOR_INVALID',
  );
  await expect(dispatcher.commissionParkedEventPage(1 as unknown as string, 100)).rejects.toThrow(
    'PARKED_CURSOR_INVALID',
  );
});

it('names the six counted types in the index predicate', async () => {
  const rows = await owner<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'outbox' AND indexname = 'outbox_commission_parked_idx'`;
  const definition = rows[0]?.indexdef;
  expect(definition).toBeDefined();
  const literals = [...(definition ?? '').matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]);
  expect(literals.sort()).toEqual([...COMMISSION_INPUT_EVENT_TYPES].sort());
});

it('reads the parked page through the partial index, with no scan and no sort', async () => {
  // خمس أحداث عمولة موقوفة، ثم أحداث موقوفة من أنواع أخرى، ثم أحداث غير منشورة، ثم منشورة.
  await owner`
    INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload,
      published_at, parked_at, attempts, next_attempt_at)
    SELECT ${A.company}, ('01970000-0000-7000-8000-' || lpad(n::text,12,'0'))::uuid,
      'service_session', ${A.business},
      CASE WHEN n <= 5 THEN ${COUNTED} ELSE 'OrderCompleted' END, '{}'::jsonb,
      CASE WHEN n > 40000 THEN clock_timestamp() ELSE NULL END,
      CASE WHEN n <= 20000 THEN clock_timestamp() ELSE NULL END, 0, now()
    FROM generate_series(1, 60000) AS n`;
  await owner`ANALYZE outbox`;

  const parkedSeqs = await owner<{ seq: string }[]>`
    SELECT seq::text AS seq FROM outbox
    WHERE event_type = ${COUNTED} AND parked_at IS NOT NULL ORDER BY seq`;
  const cursor = parkedSeqs[1]?.seq ?? '0';

  const replay = postgres(dispatcherUrl, { max: 1, onnotice: () => undefined });
  try {
    for (const pageCursor of ['0', cursor]) {
      capture.enabled = true;
      await dispatcher.commissionParkedEventPage(pageCursor, 100);
      capture.enabled = false;
      const statement = capture.statements.at(-1);
      if (statement === undefined) throw new Error('PARKED_PAGE_STATEMENT_MISSING');
      const plan = await replay.unsafe(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.query}`,
        statement.parameters,
      );
      const text = JSON.stringify(plan);
      expect(text).toContain('outbox_commission_parked_idx');
      expect(text).not.toContain('Seq Scan');
      expect(text).not.toContain('"Node Type":"Sort"');
      expect(text).not.toMatch(/"Rows Removed by Filter":[1-9]/);
    }
  } finally {
    await replay.end();
  }
});

it('reaches the parked rows that were never published by a plain sweep', async () => {
  const event = eventId(60);
  await seedEvent(A.company, event, COUNTED, { parked: true });
  const page = await dispatcher.commissionParkedEventPage('0', 100);
  expect(page.map((row) => row.id)).toContain(event);
  await freshSweep()();
  expect(page.map((row) => row.id)).toContain(event);
});
