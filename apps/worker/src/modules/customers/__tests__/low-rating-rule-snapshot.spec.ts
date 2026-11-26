import { afterAll, beforeAll, expect, it } from 'vitest';

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { ClaimedEvent, Tx } from '@pospay/db';
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

/** قاعدة LOW_RATING على مستوى النشاط، بحالة وقنوات معيّنة. */
const saveRule = (enabled: boolean, channels: readonly string[] = ['IN_APP']) =>
  f.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${f.tenant.company},${f.ids.newId()},${f.tenant.business},NULL,'LOW_RATING',${enabled},
      ${f.owner.array(['owner', 'general_manager', 'business_manager', 'branch_manager'])},
      ${f.owner.array([...channels])},NULL,NULL,${USER},1)`;
const clearRules = () =>
  f.owner`DELETE FROM alert_rules WHERE company_id=${f.tenant.company} AND kind='LOW_RATING'`;
const setRuleEnabled = (enabled: boolean) =>
  f.owner`UPDATE alert_rules SET enabled=${enabled}, revision=revision+1
    WHERE company_id=${f.tenant.company} AND kind='LOW_RATING'`;
/** المفتاح العام للنشاط: null يعني شغّال. */
const setMasterSwitch = (enabled: boolean | null) =>
  f.owner`INSERT INTO business_settings (company_id,business_id,alerts_enabled)
    VALUES(${f.tenant.company},${f.tenant.business},${enabled})
    ON CONFLICT (company_id,business_id) DO UPDATE SET alerts_enabled=${enabled}`;

/** يشغّل المستهلك ويثبّت خطاف بعد قراءة القاعدة بالظبط. */
async function consumeAfterRuleRead(input: ClaimedEvent, hook: () => Promise<void>): Promise<void> {
  const dialect = new PgDialect();
  let fired = false;
  await f.db.withTenant(input.companyId, (tx) =>
    f.consumer.handle(
      new Proxy(tx, {
        get: (target, prop, receiver) =>
          prop === 'execute'
            ? async (query: SQL) => {
                const rows = await target.execute(query);
                if (!fired && dialect.sqlToQuery(query).sql.includes('alert_rules r ON')) {
                  fired = true;
                  await hook();
                }
                return rows;
              }
            : Reflect.get(target, prop, receiver),
      }) as Tx,
      input,
    ),
  );
}

it('a rule change committed before the snapshot decides the notice', async () => {
  await saveRule(true);
  try {
    // التغيير اتأكد قبل ما المستهلك يقرأ القاعدة، فاللقطة بتمسكه.
    await setRuleEnabled(false);
    const row = await f.rating(2);
    expect(await f.deliver(await f.event(row))).toEqual({ delivered: true });
    expect(await f.notices(row.ratingId)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.received(row.ratingId)).toHaveLength(0);
  } finally {
    await clearRules();
  }
});

it('a rule change committed after the snapshot does not flip the decision', async () => {
  await saveRule(true);
  try {
    const row = await f.rating(2);
    const input = await f.event(row);
    // التغيير بيُرسل بعد ما اللقطة اتقرت، وقبل ما المستلمين والوقت يتحسبوا.
    await consumeAfterRuleRead(input, async () => {
      await setRuleEnabled(false);
    });
    expect(await f.notices(row.ratingId)).toMatchObject([{ recipient_count: 3 }]);
    expect(await f.received(row.ratingId)).toHaveLength(1);
  } finally {
    await clearRules();
  }
});

it('a snapshot with no IN_APP channel records one terminal zero-recipient decision', async () => {
  await saveRule(true, []);
  try {
    const row = await f.rating(2);
    const input = await f.event(row);
    expect(await f.deliver(input)).toEqual({ delivered: true });
    expect(await f.notices(row.ratingId)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.received(row.ratingId)).toHaveLength(0);
    // إعادة التسليم وإعادة التشغيل ما بيفتحوش القرار ده تاني.
    await f.deliver(input);
    await f.consume({ ...input, id: f.ids.newId() });
    expect(await f.notices(row.ratingId)).toHaveLength(1);
    expect(await f.received(row.ratingId)).toHaveLength(0);
  } finally {
    await clearRules();
  }
});

it('the master switch off records the same terminal zero-recipient decision', async () => {
  await saveRule(true);
  await setMasterSwitch(false);
  try {
    const row = await f.rating(2);
    expect(await f.deliver(await f.event(row))).toEqual({ delivered: true });
    expect(await f.notices(row.ratingId)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.received(row.ratingId)).toHaveLength(0);
  } finally {
    await setMasterSwitch(null);
    await clearRules();
  }
});

it('the ledger row is stamped with the decision instant of the worker clock', async () => {
  await saveRule(true);
  try {
    const row = await f.rating(2);
    await f.deliver(await f.event(row));
    const notices = await f.notices(row.ratingId);
    expect(notices).toHaveLength(1);
    const decidedAt = notices[0]?.['decided_at'];
    expect(decidedAt).toBeInstanceOf(Date);
    expect((decidedAt as Date).getTime()).toBe(f.at.getTime());
  } finally {
    await clearRules();
  }
});

it('the rating stays committed when the worker handling aborts', async () => {
  const row = await f.rating(2, 'اتصلوا بيا على 99887766');
  const input = await f.event(row);
  const dialect = new PgDialect();
  const crashing = createDeliverer(
    {
      withTenant: (company, work) =>
        f.db.withTenant(company, (tx) =>
          work(
            new Proxy(tx, {
              get: (target, prop, receiver) =>
                prop === 'execute'
                  ? async (query: SQL) => {
                      const result = await target.execute(query);
                      const statement = dialect.sqlToQuery(query).sql;
                      if (statement.includes('INSERT INTO low_rating_notices'))
                        throw new Error('SYNTHETIC_WORKER_CRASH');
                      return result;
                    }
                  : Reflect.get(target, prop, receiver),
            }) as Tx,
          ),
        ),
    },
    [f.consumer],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  expect((await crashing(input)).delivered).toBe(false);
  // التقييم اتقدم في معاملة الـ API لوحدها، ففضل موجود بعد abort الـ worker.
  expect(
    await f.owner`SELECT stars FROM ratings WHERE company_id=${f.tenant.company} AND id=${row.ratingId}`,
  ).toMatchObject([{ stars: 2 }]);
  expect(await f.notices(row.ratingId)).toHaveLength(0);
  expect(await f.received(row.ratingId)).toHaveLength(0);
});
