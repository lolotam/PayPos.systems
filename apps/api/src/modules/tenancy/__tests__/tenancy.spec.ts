import {
  branch as branchSchema,
  business as businessSchema,
  errorEnvelope,
  page,
} from '@pospay/contracts';
import { verticalTemplate } from '@pospay/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './harness.ts';

// T8 scenarios TEN-01…05 and the API-level isolation proof (plan v4 T8, debate C11), through the API with real
// sessions: owners of company A (and A2) and of company B, each onboarded through POST /v1/companies.
let h: Harness;
let ownerA: string;
let ownerB: string;
let A: string;
let A2: string;
let B: string;
let businessB: string;
let branchB: string;

beforeAll(async () => {
  h = await startHarness();
  ownerA = await h.signedInOperator('owner-a@example.test');
  ownerB = await h.signedInOperator('owner-b@example.test');
  A = await h.onboard(ownerA, 'Company A');
  A2 = await h.onboard(ownerA, 'Company A2');
  B = await h.onboard(ownerB, 'Company B');
  // Company B's sentinel rows: they must never appear in A's responses nor change.
  const b = await h.send('POST', '/v1/businesses', {
    cookie: ownerB,
    company: B,
    key: 'sentinel-business',
    body: { vertical_type: 'salon', name_en: 'Sentinel B' },
  });
  businessB = b.body['id'] as string;
  const br = await h.send('POST', `/v1/businesses/${businessB}/branches`, {
    cookie: ownerB,
    company: B,
    key: 'sentinel-branch',
    body: { name_en: 'Sentinel Branch B' },
  });
  branchB = br.body['id'] as string;
});

afterAll(async () => {
  await h.close();
});

const rowsOf = (companyId: string) =>
  h.owner`
    SELECT 'business' AS kind, id, name_en FROM businesses WHERE company_id = ${companyId}
    UNION ALL SELECT 'branch', id, name_en FROM branches WHERE company_id = ${companyId}
    ORDER BY 1, 2`;

describe('TEN-01 — happy path per use case', () => {
  it('create-business seeds settings from the vertical template, then the client overrides; audit and event', async () => {
    const res = await h.send('POST', '/v1/businesses', {
      cookie: ownerA,
      company: A,
      key: 'ten-01-business',
      body: { vertical_type: 'restaurant', name_en: 'Diner', settings: { features: ['tables'] } },
    });
    expect(res.status).toBe(201);
    const created = businessSchema.parse(res.body);
    expect(created).toMatchObject({ company_id: A, currency: 'KWD', timezone: 'Asia/Kuwait' });
    expect(created.settings).toEqual({
      modules: verticalTemplate('restaurant')?.modules,
      features: ['tables'],
    });
    const events = await h.owner`SELECT event_type FROM outbox WHERE aggregate_id = ${created.id}`;
    expect(events.map((e) => e['event_type'])).toEqual(['BusinessCreated']);
    const audit = await h.owner`SELECT action FROM audit_log WHERE entity_id = ${created.id}`;
    expect(audit.map((a) => a['action'])).toEqual(['created']);
  });

  it('create-branch adds an active branch under the business, with audit and event', async () => {
    const business = await h.send('POST', '/v1/businesses', {
      cookie: ownerA,
      company: A,
      key: 'ten-01-business-2',
      body: { vertical_type: 'retail', name_en: 'Shop' },
    });
    const businessId = business.body['id'] as string;
    const res = await h.send('POST', `/v1/businesses/${businessId}/branches`, {
      cookie: ownerA,
      company: A,
      key: 'ten-01-branch',
      body: { name_en: 'Hawalli', geo: { lat: 29.33, lng: 48.03 } },
    });
    expect(res.status).toBe(201);
    const created = branchSchema.parse(res.body);
    expect(created).toMatchObject({ company_id: A, business_id: businessId, is_active: true });
    const events = await h.owner`SELECT event_type FROM outbox WHERE aggregate_id = ${created.id}`;
    expect(events.map((e) => e['event_type'])).toEqual(['BranchCreated']);
    const detail = await h.send('GET', `/v1/branches/${created.id}`, {
      cookie: ownerA,
      company: A,
    });
    expect(branchSchema.parse(detail.body)).toEqual(created);
  });
});

describe('TEN-02 — a duplicate Idempotency-Key', () => {
  it('replays the stored response byte for byte and writes one row', async () => {
    const request = {
      cookie: ownerA,
      company: A,
      key: 'ten-02',
      body: { vertical_type: 'salon', name_en: 'Twice' },
    };
    const first = await h.send('POST', '/v1/businesses', request);
    const again = await h.send('POST', '/v1/businesses', request);
    expect([again.status, again.text]).toEqual([first.status, first.text]);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await h.owner`SELECT 1 FROM businesses WHERE name_en = 'Twice'`).toHaveLength(1);
  });
});

describe("TEN-03 — another company's business on branch creation", () => {
  it('is the same 403 as no permission, and nothing is written in either company', async () => {
    const before = await rowsOf(B);
    const res = await h.send('POST', `/v1/businesses/${businessB}/branches`, {
      cookie: ownerA,
      company: A,
      key: 'ten-03',
      body: { name_en: 'Intruder' },
    });
    expect([res.status, errorEnvelope.parse(res.body).code]).toEqual([403, 'FORBIDDEN']);
    expect(await rowsOf(B)).toEqual(before);
    expect(await h.owner`SELECT 1 FROM branches WHERE name_en = 'Intruder'`).toHaveLength(0);
  });
});

describe('TEN-04 — switching to a company the user belongs to', () => {
  it('writes into the company the header names, and lists only that company', async () => {
    const res = await h.send('POST', '/v1/businesses', {
      cookie: ownerA,
      company: A2,
      key: 'ten-04',
      body: { vertical_type: 'laundry', name_en: 'In A2' },
    });
    expect([res.status, res.body['company_id']]).toEqual([201, A2]);
    const list = await h.send('GET', '/v1/businesses', { cookie: ownerA, company: A2 });
    const listed = page(businessSchema).parse(list.body);
    expect(listed.items.map((b) => b.name_en)).toEqual(['In A2']);
  });
});

describe('TEN-05 and the isolation proof — a company the user does not belong to', () => {
  it('is refused before withTenant(B) is entered, runs no tenant query, and leaves B untouched', async () => {
    const before = await rowsOf(B);
    h.calls.tenant.length = 0;
    const attempts = [
      await h.send('GET', '/v1/businesses', { cookie: ownerA, company: B }),
      await h.send('GET', `/v1/branches/${branchB}`, { cookie: ownerA, company: B }),
      await h.send('POST', '/v1/businesses', {
        cookie: ownerA,
        company: B,
        key: 'ten-05',
        body: { vertical_type: 'salon', name_en: 'Into B' },
      }),
    ];
    for (const res of attempts) {
      expect([res.status, errorEnvelope.parse(res.body).code]).toEqual([403, 'FORBIDDEN']);
      expect(res.text).not.toMatch(/Sentinel/);
    }
    // No tenant was entered at all: the refusal came from the withUser membership read alone.
    expect(h.calls.tenant).toEqual([]);
    expect(await rowsOf(B)).toEqual(before);
  });

  it("A's own list never contains B's rows", async () => {
    const list = await h.send('GET', '/v1/businesses', { cookie: ownerA, company: A });
    expect(list.text).not.toMatch(/Sentinel/);
    expect(
      page(businessSchema)
        .parse(list.body)
        .items.every((b) => b.company_id === A),
    ).toBe(true);
  });
});
