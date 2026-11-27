import { afterAll, beforeAll, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { lowRatingReceived } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { lowRatingFixture, type LowRatingFixture } from './low-rating-notice.fixture.ts';

let f: LowRatingFixture;
beforeAll(async () => {
  f = await lowRatingFixture();
});
afterAll(async () => {
  await f?.close();
});

const COMMENT = 'اتصلوا بيا على 99887766';
type Recipient = { user_id: string; template_key: string; safe_parameters: { value: unknown }[] };
const payloads = (rows: Record<string, unknown>[]) =>
  rows.map((row) => lowRatingReceived.parse(row['payload']));
const recipients = (rows: Record<string, unknown>[]): Recipient[] =>
  payloads(rows).flatMap((payload) => payload.notification_recipients as Recipient[]);
const consumed = (eventId: string) =>
  f.owner`SELECT event_id FROM consumed_events WHERE company_id=${f.tenant.company} AND consumer_id=${f.consumer.id} AND event_id=${eventId}`;
const sorted = (...users: string[]) => [...users].sort();
const saveRule = (enabled: boolean) =>
  f.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${f.tenant.company},${f.ids.newId()},${f.tenant.business},NULL,'LOW_RATING',${enabled},
      ${f.owner.array(['owner', 'general_manager', 'business_manager', 'branch_manager'])},
      ARRAY['IN_APP']::text[],NULL,NULL,${USER},1)`;
const clearRules = () =>
  f.owner`DELETE FROM alert_rules WHERE company_id=${f.tenant.company} AND kind='LOW_RATING'`;

it('RT-22/RT-23: a 2-star rating without a comment makes one event with the saved facts only', async () => {
  const row = await f.rating(2);
  expect(await f.deliver(await f.event(row))).toEqual({ delivered: true });
  const events = await f.received(row.ratingId);
  expect(events).toHaveLength(1);
  const { users } = f;
  expect(recipients(events).map((r) => [r.user_id, r.template_key])).toEqual(
    sorted(users.owner, users.holder, users.denied).map((id) => [id, 'low_rating']),
  );
  const [first] = recipients(events);
  expect(first?.safe_parameters[0]?.value).toEqual({
    stars: 2,
    branch_name_ar: null,
    branch_name_en: 'Branch A',
    business_date: expect.stringMatching(/^2026-01-\d{2}$/),
    performers: [
      { name_ar: null, name_en: 'Synthetic' },
      { name_ar: null, name_en: 'Synthetic' },
    ],
    customer_name: 'Synthetic customer',
    phone_last3: '123',
  });
  expect(JSON.stringify(payloads(events))).not.toMatch(/2025550123|token|comment/i);
  expect(await f.notices(row.ratingId)).toMatchObject([{ recipient_count: 3 }]);
});

it('the ledger row carries the business and branch of the stored rating it decided', async () => {
  const row = await f.rating(2);
  await f.deliver(await f.event(row));
  const joined = await f.owner`SELECT n.business_id = r.business_id AS same_business,
      n.branch_id = r.branch_id AS same_branch
    FROM low_rating_notices n JOIN ratings r ON r.company_id = n.company_id AND r.id = n.rating_id
    WHERE n.company_id = ${f.tenant.company} AND n.rating_id = ${row.ratingId}`;
  expect(joined.map((r) => [r['same_business'], r['same_branch']])).toEqual([[true, true]]);
});

it('a 1-star rating is low too; a 3-star rating makes no event and no ledger row', async () => {
  const one = await f.rating(1);
  await f.deliver(await f.event(one));
  expect(await f.received(one.ratingId)).toHaveLength(1);
  const three = await f.rating(3);
  expect(await f.deliver(await f.event(three))).toEqual({ delivered: true });
  expect(await f.received(three.ratingId)).toHaveLength(0);
  expect(await f.notices(three.ratingId)).toHaveLength(0);
});

it('RT-22/BR-B5: a rule that is off records zero recipients and emits nothing', async () => {
  await saveRule(false);
  try {
    const row = await f.rating(2, COMMENT);
    expect(await f.deliver(await f.event(row))).toEqual({ delivered: true });
    expect(await f.notices(row.ratingId)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.received(row.ratingId)).toHaveLength(0);
  } finally {
    await clearRules();
  }
});

it('BR-B4/RT-Q17: the comment reaches readers as written and the DENY-holder gets the notice without it', async () => {
  const row = await f.rating(2, COMMENT);
  await f.deliver(await f.event(row));
  const events = await f.received(row.ratingId);
  expect(events).toHaveLength(2);
  const [withComment, plain] = events.map((event) => lowRatingReceived.parse(event['payload']));
  expect(withComment?.notification_recipients.flatMap((r) =>
      'user_id' in r ? [[r.user_id, r.template_key]] : [],
    )).toEqual(
    sorted(f.users.owner, f.users.holder).map((id) => [id, 'low_rating_with_comment']),
  );
  expect(JSON.stringify(withComment)).toContain(COMMENT);
  expect(plain?.notification_recipients.flatMap((r) =>
      'user_id' in r ? [[r.user_id, r.template_key]] : [],
    )).toEqual([
    [f.users.denied, 'low_rating'],
  ]);
  expect(JSON.stringify(plain)).not.toContain('99887766');
  expect(await f.notices(row.ratingId)).toMatchObject([{ recipient_count: 3 }]);
});

it('RT-Q17: a stored comment the current public rule would refuse (link, markup, control character) still reaches readers as written and the notice is not suppressed', async () => {
  const written = 'see https://salon.example/x <b>bad</b>\u0007 [x](y)';
  const row = await f.rating(2, written);
  expect(await f.deliver(await f.event(row))).toEqual({ delivered: true });
  const events = await f.received(row.ratingId);
  expect(events).toHaveLength(2);
  const [withComment, plain] = events.map((event) => lowRatingReceived.parse(event['payload']));
  expect(withComment?.notification_recipients.flatMap((r) =>
      'user_id' in r ? [[r.user_id, r.template_key]] : [],
    )).toEqual(
    sorted(f.users.owner, f.users.holder).map((id) => [id, 'low_rating_with_comment']),
  );
  const bell = withComment?.notification_recipients.find((r) => r.channel === 'IN_APP');
  expect(bell?.channel === 'IN_APP' ? bell.safe_parameters[0].value : null).toMatchObject({
    comment: written,
  });
  expect(plain?.notification_recipients.map((r) => r.template_key)).toEqual(['low_rating']);
  expect(await f.notices(row.ratingId)).toMatchObject([{ recipient_count: 3 }]);
});

it('a redelivered event and a replayed handler make no second ledger row or notice', async () => {
  const row = await f.rating(2);
  const input = await f.event(row);
  await f.deliver(input);
  await f.deliver(input);
  await f.consume(input);
  await f.consume({ ...input, id: f.ids.newId() });
  expect(await f.notices(row.ratingId)).toHaveLength(1);
  expect(await f.received(row.ratingId)).toHaveLength(1);
});

it('an event that disagrees with the stored rating or the envelope is retried, then parked', async () => {
  const row = await f.rating(2);
  const input = await f.event(row);
  const bad = [
    await f.event(row, { stars: 1 }),
    await f.event(row, { branch_id: f.ids.newId() }),
    { ...input, aggregateId: f.ids.newId() },
    { ...input, payload: { ...(input.payload as object), extra: true } },
  ];
  for (const event of bad) expect((await f.deliver(event)).delivered).toBe(false);
  expect(await f.notices(row.ratingId)).toHaveLength(0);
  expect(await f.received(row.ratingId)).toHaveLength(0);
});

it('an event naming another tenant cannot see the rating and affects nothing', async () => {
  const row = await f.rating(2);
  const input = await f.event(row);
  expect((await f.deliver({ ...input, companyId: f.otherTenant.company })).delivered).toBe(false);
  expect(await f.notices(row.ratingId)).toHaveLength(0);
  expect(await f.received(row.ratingId)).toHaveLength(0);
  expect(
    await f.owner`SELECT 1 FROM low_rating_notices WHERE company_id=${f.otherTenant.company}`,
  ).toHaveLength(0);
});

it('a closed company returns silently with no ledger row', async () => {
  const row = await f.rating(2);
  const input = await f.event(row);
  await f.owner`UPDATE companies SET deleted_at=${f.at} WHERE id=${f.tenant.company}`;
  try {
    expect((await f.deliver(input)).delivered).toBe(true);
  } finally {
    await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${f.tenant.company}`;
  }
  expect(await f.notices(row.ratingId)).toHaveLength(0);
  expect(await f.received(row.ratingId)).toHaveLength(0);
});

it.each(['ledger', 'outbox', 'consumed'])(
  'a crash after the %s write rolls back everything and the retry produces the whole notice',
  async (stage) => {
    const row = await f.rating(2, COMMENT);
    const input = await f.event(row);
    const dialect = new PgDialect();
    const crashing = createDeliverer(
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
                          const hit = {
                            ledger: 'INSERT INTO low_rating_notices',
                            outbox: 'INSERT INTO outbox',
                            consumed: 'INSERT INTO consumed_events',
                          }[stage];
                          if (hit !== undefined && statement.includes(hit))
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
    expect((await crashing(input)).delivered).toBe(false);
    expect(await f.notices(row.ratingId)).toHaveLength(0);
    expect(await f.received(row.ratingId)).toHaveLength(0);
    expect(await consumed(input.id)).toHaveLength(0);
    expect((await f.deliver(input)).delivered).toBe(true);
    expect(await f.notices(row.ratingId)).toHaveLength(1);
    expect(await f.received(row.ratingId)).toHaveLength(2);
  },
);

it('an event naming another request of the same tenant never matches the stored rating', async () => {
  const row = await f.rating(2);
  const other = await f.rating(2);
  const input = await f.event({ ...row, requestId: other.requestId });
  expect((await f.deliver(input)).delivered).toBe(false);
  expect(await f.notices(row.ratingId)).toHaveLength(0);
});

/** يسجل مفاتيح الصفوف التي رجعت من كل `execute`، فنعرف هل دخل نص التعليق ذاكرة الـ worker. */
async function consumeRecordingRowKeys(input: Parameters<typeof f.consume>[0]) {
  const keys: string[] = [];
  await f.db.withTenant(input.companyId, (tx) =>
    f.consumer.handle(
      new Proxy(tx, {
        get: (target, prop, receiver) =>
          prop === 'execute'
            ? async (query: SQL) => {
                const rows = (await target.execute(query)) as Record<string, unknown>[];
                for (const row of rows) keys.push(...Object.keys(row));
                return rows;
              }
            : Reflect.get(target, prop, receiver),
      }) as Tx,
      input,
    ),
  );
  return keys;
}

it('F3: the comment text never reaches worker memory when the rule is off', async () => {
  await saveRule(false);
  try {
    const row = await f.rating(2, COMMENT);
    expect(await consumeRecordingRowKeys(await f.event(row))).not.toContain('comment');
  } finally {
    await clearRules();
  }
});

it('F3: a lost claim reads no comment text, a won claim with readers reads it exactly once', async () => {
  const row = await f.rating(2, COMMENT);
  const first = await f.event(row);
  expect((await consumeRecordingRowKeys(first)).filter((key) => key === 'comment')).toHaveLength(1);
  const replay = await f.event(row);
  expect(await consumeRecordingRowKeys(replay)).not.toContain('comment');
});
