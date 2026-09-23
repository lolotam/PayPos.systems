import { businessSettings as settingsSchema, errorEnvelope } from '@pospay/contracts';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { createRedisSettingsCache } from '../persistence/redis-settings-cache.ts';
import { createSettingsTransactions } from '../persistence/settings-transactions.ts';

// T10-3 through the API with real Postgres and Redis: a business reads the template until it changes a value, a
// change is audited and seen by the very next read (the cache is dropped), null returns a value to the template, and
// another company's business is refused.
let h: Harness;
let owner: string;
let stranger: string;
let company: string;
let strangerCompany: string;
let business: string;

beforeAll(async () => {
  h = await startHarness();
  owner = await h.signedInOperator('settings-owner@example.test');
  stranger = await h.signedInOperator('settings-stranger@example.test');
  company = await h.onboard(owner, 'Settings Co');
  strangerCompany = await h.onboard(stranger, 'Stranger Co');
  const created = await h.send('POST', '/v1/businesses', {
    cookie: owner,
    company,
    key: 'settings-business',
    body: { vertical_type: 'salon', name_en: 'Salon' },
  });
  business = created.body['id'] as string;
});

afterAll(async () => {
  await h.close();
});

const url = () => `/v1/businesses/${business}/settings`;
const read = async () => {
  const res = await h.send('GET', url(), { cookie: owner, company });
  expect(res.status).toBe(200);
  return settingsSchema.parse(res.body);
};
const change = (body: object, cookie = owner) =>
  h.app.inject({
    method: 'PATCH',
    url: url(),
    headers: { cookie, 'x-company-id': company },
    payload: body,
  });

describe('business settings', () => {
  it('a business that changed nothing reads the template', async () => {
    expect(await read()).toEqual({
      business_id: business,
      default_language: 'ar',
      calendar: 'gregorian',
      tax_rule: null,
      overridden: [],
      updated_at: null,
    });
  });

  it('a change is audited and seen by the very next read, though the first read was cached', async () => {
    await read();
    const res = await change({ calendar: 'hijri' });
    expect(res.statusCode).toBe(200);
    const updated = settingsSchema.parse(res.json());
    expect(updated).toMatchObject({ calendar: 'hijri', overridden: ['calendar'] });
    expect(await read()).toEqual(updated);
    const [audit] =
      await h.owner`SELECT before, after FROM audit_log WHERE entity_id = ${business} AND action = 'settings.changed'`;
    expect(audit).toEqual({
      before: { default_language: null, calendar: null },
      after: { default_language: null, calendar: 'hijri' },
    });
  });

  it('a key left out stays; null returns it to the template', async () => {
    await change({ default_language: 'en' });
    expect(await read()).toMatchObject({
      default_language: 'en',
      calendar: 'hijri',
      overridden: ['default_language', 'calendar'],
    });
    await change({ calendar: null });
    expect(await read()).toMatchObject({
      default_language: 'en',
      calendar: 'gregorian',
      overridden: ['default_language'],
    });
  });

  it('an empty change, an unknown key or an unknown value is a 400', async () => {
    for (const body of [{}, { theme: 'dark' }, { calendar: 'julian' }]) {
      const res = await change(body);
      expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    }
  });
});

describe('another company', () => {
  it("another company's owner, in their own company, is refused this business on both routes", async () => {
    const before = await read();
    const [audits] =
      await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${business}`;
    const asStranger = (method: 'GET' | 'PATCH') =>
      h.app.inject({
        method,
        url: url(),
        headers: { cookie: stranger, 'x-company-id': strangerCompany },
        ...(method === 'PATCH' ? { payload: { calendar: 'hijri' } } : {}),
      });
    expect((await asStranger('GET')).statusCode).toBe(403);
    expect((await asStranger('PATCH')).statusCode).toBe(403);
    expect(await read()).toEqual(before);
    const [after] =
      await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${business}`;
    expect(after?.['n']).toBe(audits?.['n']);
  });
});

describe('concurrency', () => {
  it('a second first write waits for the first, and sees its value as before', async () => {
    const created = await h.send('POST', '/v1/businesses', {
      cookie: owner,
      company,
      key: 'settings-race',
      body: { vertical_type: 'retail', name_en: 'Race' },
    });
    const raced = created.body['id'] as string;
    const [row] = await h.owner`SELECT id FROM "user" WHERE email = 'settings-owner@example.test'`;
    const userId = row?.['id'] as string;
    const database = createDatabase({ url: h.urls.app, ids: systemUuidV7() });
    const transactions = createSettingsTransactions(database, systemUuidV7());
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    try {
      const first = transactions.run(company, userId, async (scope) => {
        await scope.findForUpdate(raced);
        await gate;
        return scope.save(raced, { defaultLanguage: 'en' }, userId);
      });
      await new Promise((done) => setTimeout(done, 200));
      const second = transactions.run(company, userId, (scope) => scope.findForUpdate(raced));
      await new Promise((done) => setTimeout(done, 200));
      open();
      await first;
      expect(await second).toMatchObject({ defaultLanguage: 'en', calendar: null });
    } finally {
      open();
      await database.close();
    }
  });

  it('a read that raced a write cannot cache the value from before it', async () => {
    const cache = createRedisSettingsCache(h.redis);
    const seen = await cache.read(company, business);
    await cache.invalidate(company, business);
    await cache.fill(company, business, seen.generation, '{"stale":true}');
    expect((await cache.read(company, business)).json).toBeNull();
    expect(await read()).not.toHaveProperty('stale');
  });
});
