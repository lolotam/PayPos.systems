import { errorMessages } from '@pospay/i18n';
import { expect } from 'vitest';

import type { EmployeeFixture } from './employees.fixture.ts';

type Redis = EmployeeFixture['h']['redis'];
type Ids = { newId(): string };

export function sendCardIssue(
  f: EmployeeFixture,
  employeeId: string,
  code: string,
  key: string,
  cookie = f.cookie,
  employee = employeeId,
) {
  return f.h.send('POST', `/v1/businesses/${f.business}/employees/${employee}/cards`, {
    cookie,
    company: f.company,
    key,
    body: { card_code: code },
  });
}

export async function cardIssueSnapshot(f: EmployeeFixture) {
  const [cards] = await f.h
    .owner`SELECT count(*)::int AS n FROM employee_cards WHERE company_id=${f.company}`;
  const [audit] = await f.h
    .owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id=${f.company} AND entity='employee_card'`;
  const [idem] = await f.h
    .owner`SELECT count(*)::int AS n FROM idempotency_keys WHERE company_id=${f.company}`;
  return { cards: Number(cards?.['n']), audit: Number(audit?.['n']), idem: Number(idem?.['n']) };
}

export async function expectCardIssueLimited(
  f: EmployeeFixture,
  ids: Ids,
  readLogs: () => string,
  employeeId: string,
  code: string,
  cookie = f.cookie,
) {
  const from = readLogs().length;
  const start = f.h.calls.statements.length;
  const before = await cardIssueSnapshot(f);
  const response = await sendCardIssue(f, employeeId, code, ids.newId(), cookie);
  const sqlText = f.h.calls.statements
    .slice(start)
    .map((statement) => statement.sql)
    .join('\n');
  expect(response.status).toBe(429);
  expect(response.body).toMatchObject({
    code: 'TOO_MANY_REQUESTS',
    ...errorMessages('TOO_MANY_REQUESTS'),
  });
  const retryAfter = Number(response.headers['retry-after']);
  const ttl = await f.h.redis.ttl(`rate:card-issue:${f.company}:${f.userId}`);
  expect(retryAfter).toBeGreaterThan(60);
  expect(Math.abs(retryAfter - ttl)).toBeLessThanOrEqual(2);
  expect(sqlText).not.toContain('INSERT INTO');
  expect(sqlText).not.toContain('UPDATE employee_cards');
  expect(sqlText).not.toContain('UPDATE idempotency_keys');
  expect(sqlText).not.toContain('audit_log');
  expect(await cardIssueSnapshot(f)).toEqual(before);
  const line = readLogs().slice(from);
  expect(line).toContain('employee card issue limited');
  expect(line).not.toContain(code);
}

export async function hireLimitPeer(f: EmployeeFixture, ids: Ids) {
  const cookie = await f.h.signedInOperator('card-limit-peer@example.test');
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email='card-limit-peer@example.test'`;
  const userId = String(user?.['id']);
  const [role] = await f.h
    .owner`SELECT id FROM roles WHERE company_id=${f.company} AND code='synthetic_employee_editor'`;
  const memberId = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${memberId},${userId},${String(role?.['id'])},${f.company},'COMPANY',${f.company})`;
  await f.h
    .owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${ids.newId()},${memberId},'manage:employees:business','ALLOW','BUSINESS',${f.business},'Synthetic grant',${userId})`;
  return { cookie, userId };
}

/** أول حفظ لعلامة الاكتمال يفشل مرة واحدة، ثم Redis يرجع لسلوكه. */
export async function whenCompletionMarkerFails<T>(redis: Redis, run: () => Promise<T>): Promise<T> {
  const original = redis.set;
  let failed = false;
  redis.set = function patched(this: typeof redis, ...args: unknown[]) {
    const name = String(args[0]);
    if (!failed && name.includes('rate:done:card-issue:')) {
      failed = true;
      return Promise.reject(new Error('redis down'));
    }
    return original.apply(this, args as never);
  } as typeof redis.set;
  try {
    return await run();
  } finally {
    redis.set = original;
  }
}

export function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
