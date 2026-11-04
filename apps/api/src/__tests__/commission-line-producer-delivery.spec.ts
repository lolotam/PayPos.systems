import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterEach, expect, it } from 'vitest';
import {
  completeJourney,
  consume,
  createDeliverer,
  createLogger,
  ids,
  journeyFixture,
  must,
  projection,
  recordJourney,
  savedEvents,
  type JourneyFixture,
} from './commission-line-producer-journey.fixture.ts';

let f: JourneyFixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});

it('five saved HTTP events reordered with cancellation before recording and duplicates equal the ordered projection', async () => {
  f = await journeyFixture();
  const journey = await completeJourney(f);
  await consume(f, journey.events);
  const ordered = await projection(f);
  expect(ordered.heads).toHaveLength(4);
  expect(ordered.rows).toHaveLength(4);
  expect(ordered.marks).toHaveLength(5);
  const permutations = [
    [4, 0, 3, 1, 2, 4, 0, 1, 3, 2],
    [1, 4, 2, 0, 3, 0, 4, 2, 1, 3],
  ];
  for (const order of permutations) {
    await clearOwnedProjection(f, journey.session.id, journey.events);
    expect(await projection(f)).toEqual({ heads: [], rows: [], marks: [] });
    await consume(
      f,
      order.map((index) => must(journey.events[index])),
    );
    expect(await projection(f)).toEqual(ordered);
    expect(await savedEvents(f, journey.session.id)).toEqual(journey.events);
    expect((await projection(f)).marks.map((mark) => mark['event_id']).sort()).toEqual(
      journey.events.map((event) => event.id).sort(),
    );
  }
}, 120_000);

async function clearOwnedProjection(
  fixture: JourneyFixture,
  sessionId: string,
  events: readonly ClaimedEvent[],
) {
  expect(events).toHaveLength(5);
  expect(
    events.every((event) => event.companyId === fixture.company && event.aggregateId === sessionId),
  ).toBe(true);
  const database = await fixture.h.owner<{ name: string }[]>`SELECT current_database() AS name`;
  expect(must(database[0]).name).toBe(fixture.databaseName);
  expect(fixture.databaseName.startsWith(`pospay_test_${fixture.runId}_`)).toBe(true);
  // إعادة المقارنة تخص نسخة الحاضنة الحالية وأحداث زيارتها فقط، ولا تغيّر التاريخ الأصلي أو حراس التخزين.
  await fixture.h.owner.begin(async (tx) => {
    await tx`DELETE FROM commission_lines WHERE company_id=${fixture.company} AND line_id IN
      (SELECT line_id FROM commission_line_heads WHERE company_id=${fixture.company} AND session_id=${sessionId})`;
    await tx`DELETE FROM commission_line_heads WHERE company_id=${fixture.company} AND session_id=${sessionId}`;
    for (const event of events)
      await tx`DELETE FROM consumed_events
      WHERE company_id=${fixture.company} AND consumer_id=${fixture.consumer.id} AND event_id=${event.id}`;
  });
}

it('both real record and cancellation deliveries wait behind the same identity lock on independent connections, then converge at revision 4', async () => {
  f = await journeyFixture();
  const journey = await completeJourney(f);
  await consume(f, [must(journey.events[1])]);
  const pools = [
    createDatabase({ url: f.h.urls.app, ids, maxConnections: 1 }),
    createDatabase({ url: f.h.urls.app, ids, maxConnections: 1 }),
  ];
  const locker = postgres(f.h.urls.owner, { max: 1, onnotice: () => undefined });
  const pids = new Map<string, number>();
  const lockKey = `${f.company}:commission-line:${journey.sharedLine.id}`;
  let release: () => void = () => undefined;
  let finished: Promise<unknown> = Promise.resolve();
  let pending: Promise<unknown>[] = [];
  let failure: unknown;
  try {
    const held = await holdLock(locker, lockKey);
    release = held.release;
    finished = held.finished;
    const deliveries = pools.map((pool, index) =>
      createDeliverer(
        trackPid(pool, pids, String(index)),
        [must(f).consumer],
        createLogger('silent'),
        { knownEventTypes: must(f).consumer.eventTypes, timeoutMs: 15_000 },
      ),
    );
    pending = [
      must(deliveries[0])(must(journey.events[0])),
      must(deliveries[1])(must(journey.events[4])),
    ];
    expect(
      await waitingDeliveries(f, lockKey, pids),
      'both actual deliveries must be waiting before unlock',
    ).toBe(2);
    expect(new Set(pids.values()).size).toBe(2);
    release();
    await finished;
    expect(await Promise.all(pending)).toEqual([{ delivered: true }, { delivered: true }]);
    await consume(f, [must(journey.events[2]), must(journey.events[3])]);
    await assertConverged(f, journey);
  } catch (error) {
    failure = error;
  } finally {
    release();
    const drained = await Promise.allSettled([...pending, finished]);
    const closed = await Promise.allSettled([...pools.map((pool) => pool.close()), locker.end()]);
    propagate(failure, [...drained, ...closed]);
  }
}, 120_000);

function trackPid(
  database: Database,
  pids: Map<string, number>,
  label: string,
): Pick<Database, 'withTenant'> {
  return {
    withTenant: (company, work, options) =>
      database.withTenant(
        company,
        async (tx) => {
          const rows = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
          pids.set(label, must(rows[0]).pid);
          return work(tx);
        },
        options,
      ),
  };
}

async function holdLock(locker: postgres.Sql, key: string) {
  let acquired: () => void = () => undefined;
  let release: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    acquired = () => resolve();
  });
  const released = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const finished = locker.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    acquired();
    await released;
  });
  await Promise.race([
    ready,
    finished.then(() => {
      throw new Error('Identity lock ended before acquisition');
    }),
  ]);
  return { release, finished };
}

async function waitingDeliveries(fixture: JourneyFixture, key: string, pids: Map<string, number>) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await fixture.h.owner<{ pid: number }[]>`
      WITH identity AS (SELECT hashtextextended(${key},0) AS key)
      SELECT pid FROM pg_locks WHERE locktype='advisory' AND objsubid=1 AND NOT granted
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND classid::bigint::numeric * 4294967296 + objid::bigint::numeric =
          (SELECT CASE WHEN key>=0 THEN key::numeric ELSE key::numeric+18446744073709551616 END FROM identity)`;
    const waiting = rows.filter((row) => [...pids.values()].includes(row.pid));
    if (pids.size === 2 && new Set(waiting.map((row) => row.pid)).size === 2) return 2;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  return 0;
}

function propagate(failure: unknown, results: PromiseSettledResult<unknown>[]) {
  const errors = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
  if (failure !== undefined) errors.unshift(failure);
  if (errors.length) throw new AggregateError(errors, 'Journey delivery or cleanup failed');
}

it('real consumer handle throws after its effect and before commit: rows and mark roll back, normal retry applies once', async () => {
  f = await journeyFixture();
  const journey = await recordJourney(f);
  const events = await savedEvents(f, journey.session.id);
  expect(events).toHaveLength(1);
  const consumer = f.consumer;
  let inside: { heads: number; rows: number; marks: number } | undefined;
  const failing = {
    ...consumer,
    handle: async (...args: Parameters<typeof consumer.handle>) => {
      await consumer.handle(...args);
      const [tx] = args;
      inside = {
        heads: (
          await tx.execute(
            sql`SELECT line_id FROM commission_line_heads WHERE company_id=${must(f).company}`,
          )
        ).length,
        rows: (
          await tx.execute(
            sql`SELECT line_id FROM commission_lines WHERE company_id=${must(f).company}`,
          )
        ).length,
        marks: (
          await tx.execute(sql`SELECT event_id FROM consumed_events WHERE company_id=${must(f).company}
        AND consumer_id=${consumer.id} AND event_id=${must(events[0]).id}`)
        ).length,
      };
      throw new Error('Injected failure after real consumer effect');
    },
  };
  const deliver = createDeliverer(f.db, [failing], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  expect(await deliver(must(events[0]))).toMatchObject({ delivered: false, error: 'Error' });
  expect(inside).toEqual({ heads: 2, rows: 3, marks: 1 });
  expect(await projection(f)).toEqual({ heads: [], rows: [], marks: [] });
  await consume(f, events);
  const applied = await projection(f);
  expect(applied.heads).toHaveLength(2);
  expect(applied.rows).toHaveLength(3);
  expect(applied.marks).toEqual([{ event_id: must(events[0]).id, consumer_id: consumer.id }]);
  await consume(f, events);
  expect(await projection(f)).toEqual(applied);
  expect(await savedEvents(f, journey.session.id)).toEqual(events);
}, 120_000);

async function assertConverged(
  fixture: JourneyFixture,
  journey: Awaited<ReturnType<typeof completeJourney>>,
) {
  const stored = await projection(fixture);
  expect(stored.heads.find((head) => head['line_id'] === journey.sharedLine.id)).toMatchObject({
    revision: 4,
    status: 'CANCELLED',
  });
  expect(stored.rows.filter((row) => row['line_id'] === journey.sharedLine.id)).toMatchObject([
    {
      employee_id: must(fixture.employees[2]),
      net: '27.001',
      net_share: '27.001',
      status: 'CANCELLED',
    },
  ]);
  expect(stored.heads).toHaveLength(4);
  expect(stored.rows).toHaveLength(4);
  expect(stored.marks).toHaveLength(5);
}
