import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { recordServiceSessionResponse } from '@pospay/contracts';
import * as performerAdapter from '../persistence/performer-check.adapter.ts';
import { sessionFixture, ids, must, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });
const post = (body: object, url = f.base) => f.h.send('POST', url, { cookie: f.cookie, company: f.company, key: ids.newId(), body });
const effects = () => f.h.owner`SELECT
  (SELECT count(*) FROM service_sessions) AS sessions,
  (SELECT count(*) FROM service_lines) AS lines,
  (SELECT count(*) FROM line_performers) AS performers,
  (SELECT count(*) FROM outbox) AS events,
  (SELECT count(*) FROM audit_log) AS audits,
  (SELECT count(*) FROM idempotency_keys) AS keys`;
const cases = [
  { name: 'zero performers', performers: () => [] },
  { name: 'more than four performers', performers: () => Array.from({ length: 5 }, (_, i) => ({ employee_id: f.employees[i] ?? ids.newId() })) },
  { name: 'duplicate performers', performers: () => [{ employee_id: must(f.employees[0]) }, { employee_id: must(f.employees[0]) }] },
  { name: 'mixed omitted/explicit shares', performers: () => [{ employee_id: must(f.employees[0]), share_bps: 10000 }, { employee_id: must(f.employees[1]) }] },
  ...[{ name: 'zero share', share_bps: 0 }, { name: 'fractional share', share_bps: 9999.5 },
    { name: 'sum other than 10000', share_bps: 9999 }, { name: 'negative share', share_bps: -1 },
    { name: 'share above 10000', share_bps: 10001 }].map(({ name, share_bps }) => ({ name, performers: () => [{ employee_id: must(f.employees[0]), share_bps }] })),
];

it.each(['record', 'append'].flatMap((operation) => cases.map((test) => ({ operation, ...test }))))('SS-20 $operation: $name returns indexed 422 and rolls back every effect', async ({ operation, performers }) => {
  let url = f.base;
  if (operation === 'append') {
    const initial = await post({ customer_id: f.customer, lines: [f.line()] });
    expect(initial.status).toBe(201);
    url = `${f.base}/${recordServiceSessionResponse.parse(initial.body).session.id}/lines`;
  }
  const before = await effects();
  const lines = [f.line(), { ...f.line(), performers: performers() }];
  const response = await post(operation === 'append' ? { lines } : { customer_id: f.customer, lines }, url);
  expect(response.status).toBe(422);
  expect(response.body).toMatchObject({ code: 'SESSION_PERFORMER_SHARES_INVALID', details: { input_index: 1 } });
  expect(await effects()).toEqual(before);
});

it.each(['record', 'append'].flatMap((operation) => [
  { operation, name: 'one line with no performers', lineCount: 1, performerCount: 0 },
  { operation, name: 'one line with five performers', lineCount: 1, performerCount: 5 },
  { operation, name: 'twenty lines with five distinct performers each', lineCount: 20, performerCount: 5 },
]))('issue 179 $operation: $name never reaches the staff reader', async ({ operation, lineCount, performerCount }) => {
  let url = f.base;
  if (operation === 'append') {
    const initial = await post({ customer_id: f.customer, lines: [f.line()] });
    expect(initial.status).toBe(201);
    url = `${f.base}/${recordServiceSessionResponse.parse(initial.body).session.id}/lines`;
  }
  const lines = Array.from({ length: lineCount }, () => ({ ...f.line(),
    performers: Array.from({ length: performerCount }, () => ({ employee_id: ids.newId() })) }));
  const before = await effects();
  const ports: ReturnType<typeof performerAdapter.performerCheck>[] = [];
  const original = performerAdapter.performerCheck;
  const reader = vi.spyOn(performerAdapter, 'performerCheck').mockImplementation((...args) => {
    const port = original(...args);
    const observed = { lock: vi.fn(port.lock), read: vi.fn(port.read) };
    ports.push(observed);
    return observed;
  });
  try {
    const response = await post(operation === 'append' ? { lines } : { customer_id: f.customer, lines }, url);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'SESSION_PERFORMER_SHARES_INVALID', details: { input_index: 0 } });
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      expect(port.lock).not.toHaveBeenCalled();
      expect(port.read).not.toHaveBeenCalled();
    }
    expect(await effects()).toEqual(before);
  } finally {
    reader.mockRestore();
  }
});
