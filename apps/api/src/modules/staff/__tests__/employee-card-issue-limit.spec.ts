import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';

import type { Provider } from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createRedisRateLimiter } from '../../../shared/adapters/redis-rate-limiter.ts';
import { ApiError } from '../../../shared/errors.ts';
import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';
import { EmployeeCardsController } from '../http/employee-cards.controller.ts';
import {
  CARD_ISSUE_ATTEMPTS_PER_HOUR,
  createCardIssueAttempts,
} from '../persistence/card-issue-attempts.ts';
import { createEmployeeCardHash } from '../persistence/employee-card-hash.ts';
import type { EmployeeCardRecord, EmployeeCardsPort } from '../ports/employee-cards.port.ts';
import { cardProviders } from '../staff-attendance.providers.ts';
import {
  EMPLOYEE_CARD_ACCESS,
  IssueEmployeeCard,
} from '../use-cases/issue-employee-card/issue-employee-card.usecase.ts';
import { RevokeEmployeeCard } from '../use-cases/revoke-employee-card/revoke-employee-card.usecase.ts';
import {
  cardIssueSnapshot,
  expectCardIssueLimited,
  hireLimitPeer,
  occurrences,
  sendCardIssue,
  whenCompletionMarkerFails,
} from './employee-card-issue-limit.fixture.ts';
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
  issuer = new IssueEmployeeCard(unusedCards(), attemptsFor(f.h.redis), () => undefined);
  ({ cookie: peerCookie, userId: peerId } = await peerOperator());
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function unusedCards(): EmployeeCardsPort {
  const fail = () => Promise.reject(new Error('SYNTHETIC_CARD_ISSUE'));
  return { issue: fail, revoke: fail, completedIssue: () => Promise.resolve(null) };
}
function attemptsFor(redis: EmployeeFixture['h']['redis']) {
  return createCardIssueAttempts(
    createRedisRateLimiter(redis),
    createEmployeeCardHash(cardKey),
    () => undefined,
  );
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
  return sendCardIssue(f, employeeId, code, key, cookie, employee);
}
function snapshot() {
  return cardIssueSnapshot(f);
}
function expectLimited(code: string, cookie = f.cookie) {
  return expectCardIssueLimited(f, ids, () => logs, employeeId, code, cookie);
}
function peerOperator() {
  return hireLimitPeer(f, ids);
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
    remaining: () => Promise.reject(new Error('redis down')),
  };
  const reported: unknown[] = [];
  const controller = new EmployeeCardsController(
    new IssueEmployeeCard(
      unusedCards(),
      createCardIssueAttempts(broken, createEmployeeCardHash(cardKey), (error) => {
        reported.push(error);
      }),
      () => undefined,
    ),
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
  const reply = { header() { return reply; } } as unknown as FastifyReply;
  let caught: unknown;
  try {
    await controller.issueCard(
      f.business,
      employeeId,
      { card_code: 'WmDown!1rUv' },
      request,
      reply,
      { key: ids.newId(), fingerprint: 'cd'.repeat(32) },
    );
  } catch (error) {
    caught = error;
  }
  expect(reported).toHaveLength(1);
  expect(reported[0]).toMatchObject({ message: 'redis down' });
  expect(caught).toBeInstanceOf(ApiError);
  expect(caught).toMatchObject({ code: 'NOT_READY', status: 503 });
});

it('stores a keyed issue-attempt marker and the seconds left in the window', async () => {
  const seen: string[] = [];
  const limiter: RateLimiter = {
    hit: () => Promise.resolve(seen.length === 0),
    remembered: (key) => Promise.resolve(seen.includes(key)),
    remember: (key) => {
      seen.push(key);
      return Promise.resolve();
    },
    remaining: () => Promise.resolve(2400),
  };
  const hash = createEmployeeCardHash(cardKey);
  const attempts = createCardIssueAttempts(limiter, hash, () => undefined);
  const fingerprint = createHash('sha256').update('{"card_code":"WmSecret!9zCd"}').digest('hex');
  const idempotencyKey = 'idem-key-1';
  const unkeyed = createHash('sha256')
    .update(idempotencyKey)
    .update('\0')
    .update(fingerprint)
    .digest('hex');
  const marker = hash('company', JSON.stringify([idempotencyKey, fingerprint]), 'issue-attempt');
  await expect(attempts.take('company', 'user', idempotencyKey, fingerprint)).resolves.toEqual({
    outcome: 'accepted',
  });
  await attempts.complete('company', 'user', idempotencyKey, fingerprint);
  expect(seen).toEqual([`card-issue:company:user:${marker}`]);
  expect(seen.join(' ')).not.toContain(fingerprint);
  expect(seen.join(' ')).not.toContain(unkeyed);
  await expect(attempts.take('company', 'user', idempotencyKey, fingerprint)).resolves.toEqual({
    outcome: 'replay',
  });
  await expect(attempts.take('company', 'user', idempotencyKey, 'ff'.repeat(32))).resolves.toEqual({
    outcome: 'limited',
    retryAfterSeconds: 2400,
  });
});

it('returns the card when completion marking fails and a same-key replay stays safe', async () => {
  const records = new Map<string, EmployeeCardRecord>();
  let writes = 0;
  const cards: EmployeeCardsPort = {
    issue: (_scope, _code, idem) => {
      const existing = records.get(`${idem.key}:${idem.fingerprint}`);
      if (existing !== undefined) return Promise.resolve(existing);
      writes += 1;
      const record: EmployeeCardRecord = {
        id: `card-${writes}`,
        employeeId,
        cardCodeSuffix: '9qRs',
        issuedAt: '2026-10-07T00:00:00.000Z',
        revokedAt: null,
      };
      records.set(`${idem.key}:${idem.fingerprint}`, record);
      return Promise.resolve(record);
    },
    revoke: () => Promise.reject(new Error('SYNTHETIC_CARD_REVOKE')),
    completedIssue: (_scope, idem) =>
      Promise.resolve(records.get(`${idem.key}:${idem.fingerprint}`) ?? null),
  };
  let remembers = 0;
  const limiter: RateLimiter = {
    hit: () => Promise.resolve(true),
    remembered: () => Promise.resolve(false),
    remember: () => {
      remembers += 1;
      return remembers === 1 ? Promise.reject(new Error('redis down')) : Promise.resolve();
    },
    remaining: () => Promise.resolve(3600),
  };
  const warnings: string[] = [];
  const reported: unknown[] = [];
  const issue = new IssueEmployeeCard(
    cards,
    createCardIssueAttempts(limiter, createEmployeeCardHash(cardKey), (error) => {
      reported.push(error);
    }),
    (companyId) => warnings.push(companyId),
  );
  const idem = { key: ids.newId(), fingerprint: 'cd'.repeat(32) };
  const cardScope = scope(f.userId);
  const code = 'WmMark!9qRs';
  const first = await issue.execute(cardScope, code, idem);
  expect(first).toMatchObject({ id: 'card-1', cardCodeSuffix: '9qRs' });
  expect(warnings).toEqual([f.company]);
  expect(reported).toHaveLength(1);
  expect(reported[0]).toMatchObject({ message: 'redis down' });
  const replay = await issue.execute(cardScope, code, idem);
  expect(replay).toEqual(first);
  expect(writes).toBe(1);
  expect(warnings).toEqual([f.company]);
});

it('keeps the issued card when Redis cannot store the completion marker', async () => {
  await reset(f.userId);
  const key = ids.newId();
  const code = 'WmKeep!8pQr';
  await whenCompletionMarkerFails(f.h.redis, async () => {
    const from = logs.length;
    const before = await snapshot();
    const first = await issueHttp(code, key);
    expect(first.status).toBe(200);
    expect(first.body['card_code_suffix']).toBe('8pQr');
    const issued = await snapshot();
    expect(issued.cards).toBe(before.cards + 1);
    expect(issued.idem).toBe(before.idem + 1);
    const warned = logs.slice(from);
    expect(occurrences(warned, 'employee card issue completion unrecorded')).toBe(1);
    expect(occurrences(warned, 'employee card issue attempts unavailable')).toBe(1);
    expect(warned).not.toContain(code);
    const replay = await issueHttp(code, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await snapshot()).toEqual(issued);
    expect(occurrences(logs.slice(from), 'employee card issue completion unrecorded')).toBe(1);
  });
});

it('replays the stored card when the 30th completion marker is missing', async () => {
  await reset(f.userId);
  await burn(f.userId, CARD_ISSUE_ATTEMPTS_PER_HOUR - 1);
  const key = ids.newId();
  const code = 'WmCeil!7nOp';
  await whenCompletionMarkerFails(f.h.redis, async () => {
    const before = await snapshot();
    const first = await issueHttp(code, key);
    expect(first.status).toBe(200);
    expect(first.body['card_code_suffix']).toBe('7nOp');
    const issued = await snapshot();
    expect(issued.cards).toBe(before.cards + 1);
    expect(issued.idem).toBe(before.idem + 1);
    const replay = await issueHttp(code, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await snapshot()).toEqual(issued);
    const changed = await issueHttp('WmElse!6mNo', key);
    expect(changed.status).toBe(429);
    expect(await snapshot()).toEqual(issued);
    await expectLimited('WmNew!5lMn');
  });
});
