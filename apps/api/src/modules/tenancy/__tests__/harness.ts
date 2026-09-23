import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createAuth, createPlatformUser, type AuthService } from '@pospay/auth';
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
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';

import { grantPlatformPermission } from '../../../../../../packages/db/src/platform-grants.ts';
import { PROVISIONAL_PLAN_ID, seedReferenceData } from '../../../../../../packages/db/src/seed.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createApp } from '../../../app.ts';

// A real API over a cloned database with real Better Auth sessions. Users are made the way an operator makes them,
// and every company goes through POST /v1/companies — the production path, never a raw insert.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const PASSWORD = 'operator-chosen-pass';

export interface Harness {
  readonly app: NestFastifyApplication;
  readonly owner: postgres.Sql;
  readonly auth: AuthService;
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
      body: res.json() as Record<string, unknown>,
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
 * @returns a started API, its database, and helpers that go through the real HTTP paths
 */
export async function startHarness(): Promise<Harness> {
  const testDb: TestDatabase = await createTestDatabase();
  await seedReferenceData(testDb.ownerUrl);
  const ids = systemUuidV7();
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  const auth: AuthService = await createAuth({
    databaseUrl: testDb.authUrl,
    secret: 'test-secret-that-is-long-enough-for-hmac',
    baseURL: BASE,
    trustedOrigins: [ORIGIN],
    ids,
    secureCookies: false,
    onLog: () => undefined,
  });
  const database = createDatabase({ url: testDb.appUrl, ids });
  const calls: Harness['calls'] = { tenant: [], user: [], newTenant: [], statements: [] };
  const app = await createApp(
    {
      readiness: [],
      auth: { service: auth, baseURL: BASE },
      database: spied(database, calls),
      ids,
    },
    { logger: createLogger('silent') },
  );
  const send = sender(app);
  const operator = operatorMaker(app, auth, testDb.ownerUrl, ids);
  return {
    app,
    owner,
    auth,
    ownerUrl: testDb.ownerUrl,
    urls: { app: testDb.appUrl, auth: testDb.authUrl, owner: testDb.ownerUrl },
    calls,
    send,
    signedInOperator: operator,
    onboard: async (cookie, name) => {
      const res = await send('POST', '/v1/companies', {
        cookie,
        key: `onboard-${name.replaceAll(' ', '-')}`,
        body: { name_en: name, plan_id: PROVISIONAL_PLAN_ID },
      });
      if (res.status !== 201) throw new Error(`onboarding failed with ${res.status}`);
      return res.body['id'] as string;
    },
    close: async () => {
      await app.close();
      await Promise.all([database.close(), auth.close()]);
      await owner.end();
      await testDb.drop();
    },
  };
}
