import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { errorEnvelope, serviceSessionDayPage } from '@pospay/contracts';
import { ordersDayQuery } from '../orders.module.ts';
import { BranchDayServiceSessionsQuery } from '../queries/branch-day-service-sessions.query.ts';
import { interceptDatabase, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let logs = '';
beforeAll(async () => {
  f = await sessionFixture({ logs: new Writable({ write(chunk, _encoding, done) { logs += String(chunk); done(); } }) });
  await f.create.execute({ ...f.context(), input: f.body() });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await f?.close(); });

it('logs unexpected query failure with request and tenant context without driver or saved row data', async () => {
  const get = () => f.h.app.inject({ method: 'GET', url: `${f.base}?date=2026-10-14`,
    headers: { cookie: f.ownerCookie, 'x-company-id': f.company } });
  const saved = must(serviceSessionDayPage.parse((await get()).json()).items[0]);
  const privateData = JSON.stringify(saved);
  const failure = Object.assign(new TypeError(`SELECT service_sessions params ${privateData}`, { cause: new Error(privateData) }), {
    code: 'ECONNRESET', parameters: [privateData], row: saved,
  });
  const query = ordersDayQuery(interceptDatabase(f.db, async (statement) => {
    if (statement.startsWith('WITH candidates')) throw failure;
  }));
  vi.spyOn(BranchDayServiceSessionsQuery.prototype, 'execute').mockImplementationOnce((scope, input) => query.execute(scope, input));
  logs = '';
  const response = await get();
  expect(response.statusCode).toBe(500);
  expect(errorEnvelope.parse(response.json())).toMatchObject({ code: 'INTERNAL_ERROR', message_ar: expect.any(String), message_en: expect.any(String) });
  const entries = logs.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
  const errors = entries.filter((line) => line['msg'] === 'unhandled error');
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ request_id: expect.any(String), company_id: f.company, branch_id: f.branch,
    user_id: f.ownerId, err: { type: 'TypeError', code: 'ECONNRESET' } });
  expect(new Set(entries.map((line) => line['request_id'])).size).toBe(1);
  for (const privateValue of [saved.id, saved.customer.id, saved.customer.name, saved.lines[0]?.name_en, 'SELECT', 'parameters', 'stack', 'cause']) {
    expect(logs + response.body).not.toContain(must(privateValue));
  }
});
