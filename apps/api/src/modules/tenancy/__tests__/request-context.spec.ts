import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './harness.ts';

// T11 through the real API: every request has an id (a caller's plain X-Request-Id is kept, anything else replaced),
// it is returned in the response, and the request's log line carries the verified user, company and branch.
let h: Harness;
let cookie: string;
let company: string;
let branch: string;
const lines: Record<string, unknown>[] = [];

beforeAll(async () => {
  const logs = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  h = await startHarness({ logs });
  cookie = await h.signedInOperator('context@example.test');
  company = await h.onboard(cookie, 'Context Co');
  const business = await h.send('POST', '/v1/businesses', {
    cookie,
    company,
    key: 'ctx-business',
    body: { vertical_type: 'salon', name_en: 'Ctx' },
  });
  const created = await h.send('POST', `/v1/businesses/${business.body['id'] as string}/branches`, {
    cookie,
    company,
    key: 'ctx-branch',
    body: { name_en: 'Ctx Branch' },
  });
  branch = created.body['id'] as string;
});

afterAll(async () => {
  await h.close();
});

const completed = (requestId: string) =>
  lines.find((line) => line['msg'] === 'request completed' && line['request_id'] === requestId);

describe('request context in the API', () => {
  it('the request line carries request_id, user_id, company_id and branch_id', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/branches/${branch}`,
      headers: { cookie, 'x-company-id': company, 'x-request-id': 'trace-from-admin-0001' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe('trace-from-admin-0001');
    expect(completed('trace-from-admin-0001')).toMatchObject({
      company_id: company,
      branch_id: branch,
      user_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('replaces an X-Request-Id that could forge a log line, and gives an id to requests without one', async () => {
    const forged = await h.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'bad id\n{"level":60}' },
    });
    const given = String(forged.headers['x-request-id']);
    expect(given).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(completed(given)).toBeDefined();
    const none = await h.app.inject({ method: 'GET', url: '/health' });
    expect(String(none.headers['x-request-id'])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });
});
