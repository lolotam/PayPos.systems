import { businessSettings as settingsSchema, errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// T10-3 through the API with real Postgres and Redis: a business reads the template until it changes a value, a
// change is audited and seen by the very next read (the cache is dropped), null returns a value to the template, and
// another company's business is refused.
let h: Harness;
let owner: string;
let stranger: string;
let company: string;
let business: string;

beforeAll(async () => {
  h = await startHarness();
  owner = await h.signedInOperator('settings-owner@example.test');
  stranger = await h.signedInOperator('settings-stranger@example.test');
  company = await h.onboard(owner, 'Settings Co');
  await h.onboard(stranger, 'Stranger Co');
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

  it("another company's owner is refused on both routes, and nothing changes", async () => {
    const before = await read();
    const asStranger = await h.app.inject({
      method: 'GET',
      url: url(),
      headers: { cookie: stranger, 'x-company-id': company },
    });
    expect(asStranger.statusCode).toBe(403);
    expect((await change({ calendar: 'hijri' }, stranger)).statusCode).toBe(403);
    expect(await read()).toEqual(before);
  });
});
