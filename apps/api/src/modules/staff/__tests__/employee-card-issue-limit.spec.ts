import { Writable } from 'node:stream';

import type { Provider } from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import { errorMessages } from '@pospay/i18n';
import { systemUuidV7 } from '@pospay/ids';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createRedisRateLimiter } from '../../../shared/adapters/redis-rate-limiter.ts';
import { ApiError } from '../../../shared/errors.ts';
import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';
import { EmployeeCardsController } from '../http/employee-cards.controller.ts';
import {
  CARD_ISSUE_ATTEMPTS_PER_HOUR,
  createCardIssueAttempts,
} from '../persistence/card-issue-attempts.ts';
import type { EmployeeCardsPort } from '../ports/employee-cards.port.ts';
import { cardProviders } from '../staff-attendance.providers.ts';
import {
  EMPLOYEE_CARD_ACCESS,
  IssueEmployeeCard,
} from '../use-cases/issue-employee-card/issue-employee-card.usecase.ts';
import { RevokeEmployeeCard } from '../use-cases/revoke-employee-card/revoke-employee-card.usecase.ts';
import {
  employeesFixture,
  grantEmployeeCreation,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

const ids = systemUuidV7();
const cardKey = Buffer.alloc(32, 1);
let f: EmployeeFixture;
let employeeId: string;
let colleagueId: string;
let issuer: IssueEmployeeCard;
let peerCookie: string;
let peerId: string;
let logs = '';

beforeAll(async () => {
  f = await employeesFixture({
    logs: new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
  });
  await grantEmployeeCreation(f);
  const hire = (name: string) =>
    f.useCase.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: termsFor(f, name),
    });
  employeeId = (await hire('Limit employee')).id;
  colleagueId = (await hire('Limit colleague')).id;
  issuer = new IssueEmployeeCard(unusedCards(), attemptsFor(f.h.redis));
  ({ cookie: peerCookie, userId: peerId } = await peerOperator());
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function unusedCards(): EmployeeCardsPort {
  const fail = () => Promise.reject(new Error('SYNTHETIC_CARD_ISSUE'));
  return { issue: fail, revoke: fail };
}
function attemptsFor(redis: EmployeeFixture['h']['redis']) {
  return createCardIssueAttempts(createRedisRateLimiter(redis));
}
function scope(userId: string) {
  return {
    companyId: f.company,
    businessId: f.business,
    employeeId,
    operatorId: userId,
  };
}
function provided(providers: readonly Provider[], token: unknown): unknown {
  for (const provider of providers) {
    if (typeof provider === 'object' && provider.provide === token && 'useValue' in provider) {
      return provider.useValue;
    }
  }
  return undefined;
}
async function reset(userId: string) {
  await f.h.redis.del(`rate:card-issue:${f.company}:${userId}`);
  const prefix = f.h.redis.options.keyPrefix ?? '';
  if (!prefix.startsWith('test:')) throw new Error('SYNTHETIC_REDIS_SCOPE_REQUIRED');
  const keys = await f.h.redis.keys(`${prefix}rate:*card-issue:${f.company}:${userId}*`);
  if (keys.length !== 0) await f.h.redis.del(...keys.map((key) => key.slice(prefix.length)));
}
async function burn(userId: string, times: number) {
  for (let n = 0; n < times; n += 1) {
    const attempt = issuer.execute(scope(userId), 'bad', {
      key: ids.newId(),
      fingerprint: 'ab'.repeat(32),
    });
    await expect(attempt).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
}
function issueHttp(code: string, key: string, cookie = f.cookie, employee = employeeId) {
  return f.h.send('POST', `/v1/businesses/${f.business}/employees/${employee}/cards`, {
    cookie,
    company: f.company,
    key,
    body: { card_code: code },
  });
}
async function snapshot() {
  const [cards] = await f.h
    .owner`SELECT count(*)::int AS n FROM employee_cards WHERE company_id=${f.company}`;
  const [audit] = await f.h
    .owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id=${f.company} AND entity='employee_card'`;
  const [idem] = await f.h
    .owner`SELECT count(*)::int AS n FROM idempotency_keys WHERE company_id=${f.company}`;
  return { cards: Number(cards?.['n']), audit: Number(audit?.['n']), idem: Number(idem?.['n']) };
}
async function expectLimited(code: string, cookie = f.cookie) {
  const from = logs.length;
  const start = f.h.calls.statements.length;
  const before = await snapshot();
  const response = await issueHttp(code, ids.newId(), cookie);
  const sqlText = f.h.calls.statements
    .slice(start)
    .map((statement) => statement.sql)
    .join('\n');
  expect(response.status).toBe(429);
  expect(response.body).toMatchObject({
    code: 'TOO_MANY_REQUESTS',
    ...errorMessages('TOO_MANY_REQUESTS'),
  });
  expect(response.headers['retry-after']).toBe('60');
  expect(sqlText).not.toContain('INSERT INTO');
  expect(sqlText).not.toContain('UPDATE employee_cards');
  expect(sqlText).not.toContain('UPDATE idempotency_keys');
  expect(sqlText).not.toContain('audit_log');
  expect(await snapshot()).toEqual(before);
  const line = logs.slice(from);
  expect(line).toContain('employee card issue limited');
  expect(line).not.toContain(code);
}
async function peerOperator() {
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

it('closes issue without Redis and keeps revoke', () => {
  const database = {} as TenantWrappers;
  const closed = cardProviders(database, ids, cardKey, undefined);
  expect(provided(closed, IssueEmployeeCard)).toBeNull();
  expect(provided(closed, RevokeEmployeeCard)).toBeInstanceOf(RevokeEmployeeCard);
  expect(provided(closed, EMPLOYEE_CARD_ACCESS)).not.toBeNull();
  const open = cardProviders(database, ids, cardKey, f.h.redis);
  expect(provided(open, IssueEmployeeCard)).toBeInstanceOf(IssueEmployeeCard);
});

it('rejects the 31st issue attempt in the hour and writes nothing', async () => {
  expect(CARD_ISSUE_ATTEMPTS_PER_HOUR).toBe(30);
  await reset(f.userId);
  await burn(f.userId, CARD_ISSUE_ATTEMPTS_PER_HOUR);
  await expectLimited('WmLimit!9zCd');
});

it('counts another user separately', async () => {
  await reset(f.userId);
  await reset(peerId);
  await burn(f.userId, CARD_ISSUE_ATTEMPTS_PER_HOUR);
  const issued = await issueHttp('WmPeer!8yBc', ids.newId(), peerCookie);
  expect(issued.status).toBe(200);
  expect(issued.body['card_code_suffix']).toBe('8yBc');
  await expectLimited('WmStill!7xAb');
});

it('does not count a replay of a completed key', async () => {
  await reset(f.userId);
  const key = ids.newId();
  const code = 'WmReplay!6wZa';
  const first = await issueHttp(code, key);
  expect(first.status).toBe(200);
  await burn(f.userId, CARD_ISSUE_ATTEMPTS_PER_HOUR - 1);
  const replay = await issueHttp(code, key);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  await expectLimited('WmAfter!5vYz');
});

it('counts a code already in use', async () => {
  await reset(f.userId);
  const code = 'WmOracle!4uXy';
  const first = await issueHttp(code, ids.newId());
  expect(first.status).toBe(200);
  await burn(f.userId, CARD_ISSUE_ATTEMPTS_PER_HOUR - 2);
  const conflict = await issueHttp(code, ids.newId(), f.cookie, colleagueId);
  expect(conflict.status).toBe(409);
  expect(conflict.body['code']).toBe('EMPLOYEE_CARD_CODE_IN_USE');
  await expectLimited('WmPast!2sVw');
});

it('counts a changed body on a completed key', async () => {
  await reset(f.userId);
  const key = ids.newId();
  const first = await issueHttp('WmSame!3tWx', key);
  expect(first.status).toBe(200);
  await burn(f.userId, CARD_ISSUE_ATTEMPTS_PER_HOUR - 2);
  const changed = await issueHttp('WmDiff!2sVu', key);
  expect(changed.status).toBe(422);
  expect(changed.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  await expectLimited('WmNext!1rUt');
});

it('fails closed when the limiter is unavailable', async () => {
  const broken: RateLimiter = {
    hit: () => Promise.reject(new Error('redis down')),
    remember: () => Promise.reject(new Error('redis down')),
    remembered: () => Promise.reject(new Error('redis down')),
  };
  const controller = new EmployeeCardsController(
    new IssueEmployeeCard(unusedCards(), createCardIssueAttempts(broken)),
    null,
    null,
    null,
  );
  const request = {
    principal: { companyId: f.company, userId: f.userId },
    log: {
      warn() {
        return undefined;
      },
    },
  } as unknown as FastifyRequest;
  let caught: unknown;
  try {
    await controller.issueCard(
      f.business,
      employeeId,
      { card_code: 'WmDown!1rUv' },
      request,
      { key: ids.newId(), fingerprint: 'cd'.repeat(32) },
    );
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ApiError);
  expect(caught).toMatchObject({ code: 'NOT_READY', status: 503 });
});
