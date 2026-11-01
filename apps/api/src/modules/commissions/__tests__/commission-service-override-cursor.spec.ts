import { commissionServiceOverrideList } from '@pospay/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { closeCommissionFixture, ids } from './commission-plan-versions.fixture.ts';
import {
  businessToday,
  commissionServiceOverridesFixture,
  seedOverride,
  shiftDate,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeEach(async () => {
  f = await commissionServiceOverridesFixture();
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

async function firstCursor(): Promise<string> {
  const today = await businessToday(f);
  await seedOverride(f, {
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.000001Z`,
  });
  await seedOverride(f, {
    ruleKind: 'ZERO',
    effectiveFrom: shiftDate(today, -1),
    createdAt: `${today}T09:00:00.000002Z`,
  });
  const response = await f.getOverrides('?limit=1');
  const body = commissionServiceOverrideList.parse(response.body);
  return body.next_cursor ?? '';
}

it('a malformed, an oversized and a tampered cursor are refused with 400', async () => {
  const malformed = await f.getOverrides('?cursor=not%20a%20cursor');
  expect([malformed.status, malformed.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  const oversized = await f.getOverrides(`?cursor=${'a'.repeat(600)}`);
  expect([oversized.status, oversized.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  const cursor = await firstCursor();
  const tampered = await f.getOverrides(`?cursor=${encodeURIComponent(`${cursor}x`)}`);
  expect([tampered.status, tampered.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
});

it('a cursor whose payload is not a known shape is refused and leaks nothing', async () => {
  const garbage = await f.getOverrides(`?cursor=${Buffer.from('{"v":1}').toString('base64url')}`);
  expect([garbage.status, garbage.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  expect(JSON.stringify(garbage.body)).not.toContain(f.company);
  expect(JSON.stringify(garbage.body)).not.toContain(f.employee);
});

it('a cursor from another employee or another filter is refused', async () => {
  const cursor = await firstCursor();
  const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  const foreignCursor = Buffer.from(JSON.stringify({ ...payload, e: ids.newId() })).toString(
    'base64url',
  );
  const otherEmployee = await f.getOverrides(
    `?limit=1&cursor=${encodeURIComponent(foreignCursor)}`,
  );
  expect([otherEmployee.status, otherEmployee.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  const otherFilter = await f.getOverrides(
    `?limit=1&service_id=${ids.newId()}&cursor=${encodeURIComponent(cursor)}`,
  );
  expect([otherFilter.status, otherFilter.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
});

it('a filtered cursor refuses a service position before or after its filter', async () => {
  const cursor = await firstCursor();
  const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  for (const serviceId of [
    '00000000-0000-7000-8000-000000000001',
    'ffffffff-ffff-7fff-bfff-ffffffffffff',
  ]) {
    const inconsistent = Buffer.from(
      JSON.stringify({ ...payload, f: f.service, s: serviceId }),
    ).toString('base64url');
    const response = await f.getOverrides(
      `?limit=1&service_id=${f.service}&cursor=${inconsistent}`,
    );
    expect([response.status, response.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
    expect(JSON.stringify(response.body)).not.toContain(f.company);
  }
});

it('a filtered cursor accepts the same service UUID with different letter cases', async () => {
  const cursor = await firstCursor();
  const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  for (const [filter, position] of [
    [f.service, f.service.toUpperCase()],
    [f.service.toUpperCase(), f.service],
  ]) {
    const equivalent = Buffer.from(JSON.stringify({ ...payload, f: filter, s: position })).toString(
      'base64url',
    );
    const response = await f.getOverrides(`?limit=1&service_id=${filter}&cursor=${equivalent}`);
    expect(response.status).toBe(200);
    const body = commissionServiceOverrideList.parse(response.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.service_id).toBe(f.service);
    expect(body.next_cursor).toBeNull();
  }
});

it('filtered pagination survives a case change of the same service ID between requests', async () => {
  await firstCursor();
  for (const [firstFilter, nextFilter] of [
    [f.service.toUpperCase(), f.service],
    [f.service, f.service.toUpperCase()],
  ]) {
    const first = await f.getOverrides(`?limit=1&service_id=${firstFilter}`);
    expect(first.status).toBe(200);
    const page = commissionServiceOverrideList.parse(first.body);
    const cursor = page.next_cursor;
    expect(cursor).not.toBeNull();
    const payload = JSON.parse(Buffer.from(cursor ?? '', 'base64url').toString('utf8'));
    expect(payload.f).toBe(f.service.toLowerCase());
    const next = await f.getOverrides(`?limit=1&service_id=${nextFilter}&cursor=${cursor}`);
    expect(next.status).toBe(200);
    const second = commissionServiceOverrideList.parse(next.body);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(page.items[0]?.id);
    expect(second.items[0]?.service_id).toBe(f.service);
    expect(second.next_cursor).toBeNull();
  }
});

it('an impossible instant or an extra payload field is refused before PostgreSQL can return 500', async () => {
  const cursor = await firstCursor();
  const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  for (const patch of [
    { t: '2026-02-30T09:00:00.123456Z' },
    { t: '0000-01-01T09:00:00.123456Z' },
    { t: '2026-01-01T25:00:00.123456Z' },
    { extra: true },
  ]) {
    const invalid = Buffer.from(JSON.stringify({ ...payload, ...patch })).toString('base64url');
    const response = await f.getOverrides(`?cursor=${encodeURIComponent(invalid)}`);
    expect([response.status, response.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
    expect(JSON.stringify(response.body)).not.toContain(f.company);
  }
});

it('a valid cursor keeps the pages moving', async () => {
  const cursor = await firstCursor();
  const response = await f.getOverrides(`?limit=1&cursor=${encodeURIComponent(cursor)}`);
  expect(response.status).toBe(200);
  const body = commissionServiceOverrideList.parse(response.body);
  expect(body.items).toHaveLength(1);
  expect(body.next_cursor).toBeNull();
});
