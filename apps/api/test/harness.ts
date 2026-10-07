import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createAuth,
  deriveEmployeeCardKey,
  createPlatformUser,
  type AuthService,
  type StaffOtpApi,
} from '@pospay/auth';
import {
  createDatabase,
  type Database,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { systemUuidV7 } from '@pospay/ids';
import { phoneLockKey } from '@pospay/notifications';
import { createLogger, type DestinationStream } from '@pospay/observability';
import { randomBytes } from 'node:crypto';

import { Redis } from 'ioredis';
import postgres from 'postgres';

import { grantPlatformPermission } from '../../../packages/db/src/platform-grants.ts';
import { PROVISIONAL_PLAN_ID, seedReferenceData } from '../../../packages/db/src/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../../packages/db/test/test-database.ts';
import { cleanupStack } from './cleanup-stack.ts';
import { createApp } from '../src/app.ts';
import { API_LOG_EVENTS } from '../src/shared/log-events.ts';
import type { FilesRuntime } from '../src/modules/files/index.ts';

// A real API over a cloned database with real Better Auth sessions. Users are made the way an operator makes them,
// and every company goes through POST /v1/companies — the production path, never a raw insert.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const PASSWORD = 'operator-chosen-pass';

export interface Harness {
  readonly app: NestFastifyApplication;
  readonly owner: postgres.Sql;
  readonly auth: AuthService;
  readonly redis: Redis;
  readonly ownerUrl: string;
  readonly urls: { readonly app: string; readonly auth: string; readonly owner: string };
  /**
   * What reached the database boundary, in order: every wrapper entered (with its tenant or user) and every SQL
   * statement executed inside it — the isolation proof asserts on the statements, not only on the wrapper calls.
   */
  readonly calls: {
    tenant: string[];
    user: string[];
    newTenant: string[];
    statements: { wrapper: 'tenant' | 'user' | 'new-tenant'; sql: string }[];
  };
  signedInOperator(email: string): Promise<string>;
  onboard(cookie: string, name: string): Promise<string>;
  send(
    method: 'GET' | 'POST',
    url: string,
    options: { cookie: string; company?: string; key?: string; body?: object },
  ): Promise<{
    status: number;
    body: Record<string, unknown>;
    text: string;
    headers: Record<string, unknown>;
  }>;
  close(): Promise<void>;
}

const dialect = new PgDialect();

// Every statement a wrapper's transaction executes is recorded with the wrapper that opened it.
function recording(tx: Tx, wrapper: 'tenant' | 'user' | 'new-tenant', calls: Harness['calls']): Tx {
  return new Proxy(tx, {
    get: (target, property, receiver) =>
      property === 'execute'
        ? (query: SQL) => {
            calls.statements.push({ wrapper, sql: dialect.sqlToQuery(query).sql });
            return target.execute(query);
          }
        : Reflect.get(target, property, receiver),
  });
}

// The compose Redis (T2): REDIS_URL when set, otherwise built from REDIS_PASSWORD as CI writes it.
// A key prefix per harness: rate-limit counters and pairing codes never leak between spec files or runs.
function testRedis(): Redis {
  const configured = process.env['REDIS_URL'];
  const password = encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '');
  const url =
    configured !== undefined && configured !== ''
      ? configured
      : `redis://:${password}@${process.env['REDIS_HOST'] ?? '127.0.0.1'}:${process.env['REDIS_PORT'] ?? '6379'}`;
  return new Redis(url, { keyPrefix: `test:${randomBytes(6).toString('hex')}:` });
}

function spied(database: Database, calls: Harness['calls']): TenantWrappers {
  return {
    withUser: (userId, fn) => {
      calls.user.push(userId);
      return database.withUser(userId, (tx) => fn(recording(tx, 'user', calls)));
    },
    withNewTenant: (userId, fn) => {
      calls.newTenant.push(userId);
      return database.withNewTenant(userId, (tx, id) => fn(recording(tx, 'new-tenant', calls), id));
    },
    withTenant: (companyId, fn, options) => {
      calls.tenant.push(companyId);
      return database.withTenant(companyId, (tx) => fn(recording(tx, 'tenant', calls)), options);
    },
  };
}

function sender(app: NestFastifyApplication): Harness['send'] {
  return async (method, url, options) => {
    const res = await app.inject({
      method,
      url,
      headers: {
        cookie: options.cookie,
        ...(options.company === undefined ? {} : { 'x-company-id': options.company }),
        ...(options.key === undefined ? {} : { 'idempotency-key': options.key }),
      },
      ...(options.body === undefined ? {} : { payload: options.body }),
    });
    return {
      status: res.statusCode,
      body: (res.body === '' ? {} : res.json()) as Record<string, unknown>,
      text: res.body,
      headers: res.headers,
    };
  };
}

// A user made exactly as an operator makes one — platform:create-user, the one-time link, platform:grant — signed in.
function operatorMaker(
  app: NestFastifyApplication,
  auth: AuthService,
  ownerUrl: string,
  ids: IdGenerator,
): Harness['signedInOperator'] {
  const authPost = (path: string, payload: object) =>
    app.inject({ method: 'POST', url: `/v1/auth${path}`, headers: { origin: ORIGIN }, payload });
  return async (email) => {
    const { link } = await createPlatformUser(auth, {
      email,
      name: 'User',
      operator: 'test',
      redirectTo: `${ORIGIN}/set-password`,
    });
    const token = new URL(link).pathname.split('/').pop() ?? '';
    await authPost('/reset-password', { token, newPassword: PASSWORD });
    const grant = { email, permission: 'create:companies:platform', operator: 'test' };
    await grantPlatformPermission(ownerUrl, grant, ids);
    const cookies = (await authPost('/sign-in/email', { email, password: PASSWORD })).headers[
      'set-cookie'
    ];
    return (Array.isArray(cookies) ? cookies : [cookies ?? ''])
      .map((c) => c.split(';')[0])
      .join('; ');
  };
}

/**
 * @param options where the API's log lines go (default: nowhere)
 * @param options.logs a destination stream for the API's logger
 * @returns a started API, its database, and helpers that go through the real HTTP paths
 */
interface HarnessOptions {
  files?: FilesRuntime;
  logs?: DestinationStream;
  staffOrigin?: string;
  clock?: { now(): Date };
  staffOtpFactory?: (
    auth: AuthService,
    authUrl: string,
    database: TenantWrappers,
    redis: Redis,
  ) => StaffOtpApi;
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const cleanup = cleanupStack();
  try {
    const testDb = cleanup.own(await createTestDatabase(), (value) => value.drop());
    const resources = await prepareHarness(testDb, options, cleanup);
    return describeHarness(testDb, resources, cleanup);
  } catch (error) {
    await cleanup.close().catch(() => undefined);
    throw error;
  }
}

async function prepareHarness(
  testDb: TestDatabase,
  options: HarnessOptions,
  cleanup: ReturnType<typeof cleanupStack>,
) {
  await seedReferenceData(testDb.ownerUrl);
  const ids = systemUuidV7();
  const owner = cleanup.own(
    postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined }),
    (value) => value.end(),
  );
  const auth = cleanup.own(await harnessAuth(testDb.authUrl, ids, options), (value) =>
    value.close(),
  );
  const database = cleanup.own(
    createDatabase({
      url: testDb.appUrl,
      ids,
      boundedTenantTransactions: options.staffOtpFactory !== undefined,
    }),
    (value) => value.close(),
  );
  await database.ping();
  const redis = cleanup.own(testRedis(), (value) => value.quit());
  const calls: Harness['calls'] = { tenant: [], user: [], newTenant: [], statements: [] };
  const wrappers = spied(database, calls);
  const staffOtp = options.staffOtpFactory?.(auth, testDb.authUrl, wrappers, redis);
  if (staffOtp !== undefined) cleanup.own(staffOtp, (value) => value.close());
  const app = cleanup.own(
    await createApp(
      {
        readiness: [],
        auth: { service: auth, baseURL: BASE },
        employeeCardKey: deriveEmployeeCardKey('test-secret-that-is-long-enough-for-hmac'),
        database: wrappers,
        ...(options.files === undefined ? {} : { files: options.files }),
        ...staffWiring(options, staffOtp, auth),
        ids,
        redis,
      },
      {
        logger: harnessLogger(options),
      },
    ),
    (value) => value.close(),
  );
  return { app, owner, auth, redis, calls, ids };
}

function describeHarness(
  testDb: TestDatabase,
  resources: Awaited<ReturnType<typeof prepareHarness>>,
  cleanup: ReturnType<typeof cleanupStack>,
): Harness {
  const { app, owner, auth, redis, calls, ids } = resources;
  const send = sender(app);
  return {
    app,
    owner,
    auth,
    redis,
    ownerUrl: testDb.ownerUrl,
    urls: { app: testDb.appUrl, auth: testDb.authUrl, owner: testDb.ownerUrl },
    calls,
    send,
    signedInOperator: operatorMaker(app, auth, testDb.ownerUrl, ids),
    onboard: async (cookie, name) => {
      const res = await send('POST', '/v1/companies', {
        cookie,
        key: `onboard-${name.replaceAll(' ', '-')}`,
        body: { name_en: name, plan_id: PROVISIONAL_PLAN_ID },
      });
      if (res.status !== 201) throw new Error(`onboarding failed with ${res.status}`);
      return res.body['id'] as string;
    },
    close: cleanup.close,
  };
}

function staffWiring(options: HarnessOptions, api: StaffOtpApi | undefined, auth: AuthService) {
  return options.staffOrigin === undefined
    ? {}
    : { staff: { api: api ?? null, sessions: auth.staff ?? null, origin: options.staffOrigin } };
}

function harnessLogger(options: HarnessOptions) {
  return options.logs === undefined
    ? createLogger('silent')
    : createLogger('info', { destination: options.logs, events: API_LOG_EVENTS });
}

function harnessAuth(
  authUrl: string,
  ids: IdGenerator,
  options: HarnessOptions,
): Promise<AuthService> {
  return createAuth({
    staffPhoneLockKey: phoneLockKey,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    databaseUrl: authUrl,
    secret: 'test-secret-that-is-long-enough-for-hmac',
    baseURL: BASE,
    trustedOrigins: [ORIGIN, ...(options.staffOrigin === undefined ? [] : [options.staffOrigin])],
    ids,
    secureCookies: false,
    onLog: () => undefined,
  });
}
