import { afterAll, beforeAll, expect, it } from 'vitest';

import { AUTHENTICATED_WRITES } from '../http/authenticated-writes.ts';
import { assertAuthenticatedWritesDeclared } from '../http/route-coverage.ts';
import { MeController } from '../http/me.controller.ts';
import { myPreferences } from '../queries/my-preferences.query.ts';
import { preferencesFixture } from './me-preferences.fixture.ts';

let h: Awaited<ReturnType<typeof preferencesFixture>>;
let x: { userId: string; cookie: string }, y: { userId: string; cookie: string };
const path = '/v1/me/preferences';

beforeAll(async () => {
  h = await preferencesFixture();
  x = await h.makeUser('x@nav.invalid');
  y = await h.makeUser('y@nav.invalid');
});
afterAll(async () => { await h?.close(); });
const get = (cookie = x.cookie, company?: string) => h.app.inject({ method: 'GET', url: path,
  headers: { cookie, ...(company === undefined ? {} : { 'x-company-id': company }) } });
const put = (navStyle: string | null) => h.app.inject({ method: 'PUT', url: path,
  headers: { cookie: x.cookie }, payload: { navStyle } });

it('PREF-01: an account without permissions or a workspace reads NULL without caching', async () => {
  const response = await get();
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ navStyle: null });
  expect(response.headers['cache-control']).toBe('private, no-store');
});
it('PREF-02: saves B then resets NULL', async () => {
  expect((await put('B')).json()).toEqual({ navStyle: 'B' });
  expect((await get()).json()).toEqual({ navStyle: 'B' });
  expect((await put(null)).json()).toEqual({ navStyle: null });
  expect((await get()).json()).toEqual({ navStyle: null });
});
it('PREF-03: invalid input and selectors fail validation without changing B', async () => {
  await put('B');
  for (const payload of [{ navStyle: 'D' }, {}, { navStyle: 1 }, { navStyle: 'A', extra: true },
    { navStyle: 'A', userId: y.userId }, { navStyle: 'A', companyId: h.ids.newId() }]) {
    const response = await h.app.inject({ method: 'PUT', url: path, headers: { cookie: x.cookie }, payload });
    expect([response.statusCode, response.json().code]).toEqual([400, 'VALIDATION_FAILED']);
    expect((await get()).json()).toEqual({ navStyle: 'B' });
  }
});
it('PREF-04: two accounts retain their own values and ignore stale and forged company headers', async () => {
  await put('A');
  await h.app.inject({ method: 'PUT', url: path, headers: { cookie: y.cookie, 'x-company-id': 'stale' }, payload: { navStyle: 'C' } });
  for (const company of ['stale', h.ids.newId()]) {
    expect((await get(x.cookie, company)).json()).toEqual({ navStyle: 'A' });
    expect((await get(y.cookie, company)).json()).toEqual({ navStyle: 'C' });
  }
});
it('PREF-05: no session is 401 on both routes', async () => {
  for (const method of ['GET', 'PUT'] as const) {
    const response = await h.app.inject({ method, url: path, ...(method === 'PUT' ? { payload: { navStyle: 'A' } } : {}) });
    expect([response.statusCode, response.json().code]).toEqual([401, 'UNAUTHENTICATED']);
  }
});
it('PREF-06: a real isolated staff-purpose cookie alone is 401 on both routes', async () => {
  const device = await h.device(x.userId);
  const issued = await h.auth.staff.issue(x.userId, device, async () => true);
  for (const method of ['GET', 'PUT'] as const) {
    const response = await h.app.inject({ method, url: path, headers: { cookie: issued.cookie.split(';')[0] ?? '' },
      ...(method === 'PUT' ? { payload: { navStyle: 'B' } } : {}) });
    expect([response.statusCode, response.json().code]).toEqual([401, 'UNAUTHENTICATED']);
  }
});
it('PREF-07: a real device credential alone is 403 on both routes', async () => {
  const device = await h.device(x.userId);
  for (const method of ['GET', 'PUT'] as const) {
    const response = await h.app.inject({ method, url: path, headers: { authorization: device.authorization },
      ...(method === 'PUT' ? { payload: { navStyle: 'B' } } : {}) });
    expect([response.statusCode, response.json().code]).toEqual([403, 'FORBIDDEN']);
  }
});
it('PREF-08: an existing account and a new operator account sign in and read NULL', async () => {
  await put(null);
  expect((await get(await h.login('x@nav.invalid'))).json()).toEqual({ navStyle: null });
  const created = await h.makeUser('new@nav.invalid');
  expect((await get(created.cookie)).json()).toEqual({ navStyle: null });
});
it('PREF-09: serial writes finish with the second value', async () => {
  await put('A');
  await put('B');
  expect((await get()).json()).toEqual({ navStyle: 'B' });
});
it('allows JSON PUT preflight only to a trusted origin with credentials', async () => {
  for (const origin of ['http://admin.test', 'http://other.test']) {
    const response = await h.app.inject({ method: 'OPTIONS', url: path, headers: { origin,
      'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' } });
    expect(response.headers['access-control-allow-origin']).toBe(origin === 'http://admin.test' ? origin : undefined);
    if (origin === 'http://admin.test') {
      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['access-control-allow-methods']).toContain('PUT');
    }
  }
});
it('GET, POST and simple non-JSON PUT cannot change the preference', async () => {
  await put('B');
  await get();
  expect((await h.app.inject({ method: 'POST', url: path, headers: { cookie: x.cookie }, payload: { navStyle: 'A' } })).statusCode).toBe(404);
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    const response = await h.app.inject({ method: 'PUT', url: path,
      headers: { cookie: x.cookie, 'content-type': contentType }, payload: '{"navStyle":"A"}' });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect((await get()).json()).toEqual({ navStyle: 'B' });
  }
});
it('the read query returns the contract shape through the auth port', async () => {
  expect(await myPreferences(h.auth.preferences, x.userId)).toEqual({ navStyle: 'B' });
});
it('removing the PERSONAL write declaration refuses startup coverage', () => {
  const declarations = { ...AUTHENTICATED_WRITES };
  delete declarations['MeController.setPreferencesForCaller'];
  expect(() => assertAuthenticatedWritesDeclared([MeController], declarations)).toThrow(/MeController.setPreferencesForCaller/);
});
