import { beforeAll, afterAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Tx, ClaimedEvent } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { lateNoticeFixture, type LateNoticeFixture } from './late-notice.fixture.ts';
let f: LateNoticeFixture;
beforeAll(async () => {
  f = await lateNoticeFixture();
  for (let i = 0; i < 100; i++) await f.member(await f.user(), 'owner');
});
afterAll(async () => {
  await f?.close();
});

it.each(['ledger', 'group', 'consumed'])(
  'crash after %s rolls back all effects and retry produces the entire group set',
  async (stage) => {
    const session = await f.session();
    const event = await f.event(session);
    const dialect = new PgDialect();
    const deliver = createDeliverer(
      {
        withTenant: (company, work, options) =>
          f.db.withTenant(
            company,
            (tx) =>
              work(
                new Proxy(tx, {
                  get: (target, prop, receiver) =>
                    prop === 'execute'
                      ? async (query: SQL) => {
                          const statement = dialect.sqlToQuery(query).sql;
                          const result = await target.execute(query);
                          if (
                            (stage === 'ledger' &&
                              statement.includes('INSERT INTO late_service_session_notices')) ||
                            (stage === 'group' && statement.includes('INSERT INTO outbox')) ||
                            (stage === 'consumed' &&
                              statement.includes('INSERT INTO consumed_events'))
                          )
                            throw new Error('synthetic crash');
                          return result;
                        }
                      : Reflect.get(target, prop, receiver),
                }) as Tx,
              ),
            options,
          ),
      },
      [f.consumer],
      createLogger('silent'),
      { knownEventTypes: f.consumer.eventTypes },
    );
    expect((await deliver(event)).delivered).toBe(false);
    expect(await f.notices(session)).toHaveLength(0);
    expect(await f.requests(session)).toHaveLength(0);
    expect(
      await f.owner`SELECT event_id FROM consumed_events WHERE event_id=${event.id}`,
    ).toHaveLength(0);
    expect((await f.deliver(event)).delivered).toBe(true);
    expect(await f.requests(session)).toHaveLength(2);
  },
);
it('published pre-rollout recording and first late append recover, concurrent live append and rerun converge', async () => {
  const created = await f.session(),
    appended = await f.session(false);
  const events = [
    await f.event(created),
    await f.event(appended, false),
    await f.event(appended, true, 'ServiceSessionLinesAdded'),
  ];
  await f.owner`UPDATE outbox SET published_at=clock_timestamp() WHERE company_id=${f.tenant.company}`;
  const before =
    await f.owner`SELECT id,published_at,attempts FROM outbox WHERE company_id=${f.tenant.company} ORDER BY id`;
  const live = await f.event(appended, true, 'ServiceSessionLinesAdded');
  let cursor: string | null = null,
    end: string | null = null;
  const recovered: ClaimedEvent[] = [];
  for (;;) {
    const page = await f.dispatcher.serviceSessionReplayPage(f.tenant.company, cursor, end, 1);
    end = page.throughId;
    if (!page.events.length) break;
    for (const input of page.events) {
      recovered.push(input);
      expect((await f.deliver(input)).delivered).toBe(true);
    }
    cursor = page.events.at(-1)?.id ?? cursor;
    await f.deliver(live);
  }
  expect(events.every((e) => recovered.some((r) => r.id === e.id))).toBe(true);
  expect(await f.requests(created)).toHaveLength(2);
  expect(await f.requests(appended)).toHaveLength(2);
  const page = await f.dispatcher.serviceSessionReplayPage(f.tenant.company, null, end, 100);
  for (const event of page.events) await f.deliver(event);
  expect(await f.requests(created)).toHaveLength(2);
  expect(await f.requests(appended)).toHaveLength(2);
  const after =
    await f.owner`SELECT id,published_at,attempts FROM outbox WHERE company_id=${f.tenant.company} ORDER BY id`;
  expect(after.filter((r) => before.some((b) => b['id'] === r['id']))).toEqual(before);
  const app = f.db.withTenant(f.tenant.company, (tx) => tx.execute(sql`SELECT id FROM outbox`));
  await expect(app).rejects.toThrow();
  await expect(f.dispatcher.serviceSessionReplayPage('invalid', null, null, 100)).rejects.toThrow(
    'REPLAY_SCOPE_INVALID',
  );
  await expect(
    f.dispatcher.serviceSessionReplayPage(f.tenant.company, null, null, 101),
  ).rejects.toThrow();
});
