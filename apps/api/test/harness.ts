import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPlatformUser, type AuthService } from '@pospay/auth';
import {
  createDatabase,
  type Database,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { systemUuidV7 } from '@pospay/ids';
import { randomBytes } from 'node:crypto';

import { Redis } from 'ioredis';
import postgres from 'postgres';

import { grantPlatformPermission } from '../../../packages/db/src/platform-grants.ts';
import { PROVISIONAL_PLAN_ID, seedReferenceData } from '../../../packages/db/src/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../../packages/db/test/test-database.ts';
import { cleanupStack } from './cleanup-stack.ts';
import { testEmployeeCardKey } from './employee-card-key.ts';
import {
  HARNESS_BASE,
  HARNESS_ORIGIN,
  harnessAuth,
  harnessAuthOrigins,
  harnessLogger,
  optionalWiring,
  personalWiring,
  staffWiring,
  type HarnessOptions,
} from './harness-wiring.ts';
import { createApp } from '../src/app.ts';

export {
  readSessionServices,
  readCommissionOverrideServices,
  readCommissionServiceNames,
} from '../src/modules/catalog/index.ts';
// جملة الـ EXPLAIN للاختبارات بس: استيراد معامل من ملف الـ persistence، مش من السطح العام للوحدة.
export { commissionOverrideServicesStatement } from '../src/modules/catalog/persistence/commission-override-services.reader.ts';
export {
  readCommissionFeatureEnabled,
  readCommissionPlanAccess,
  readCommissionPlanListAccess,
  readCommissionApproveAccess,
  readCommissionReviewAccess,
  readCommissionScope,
  readExplicitCompanyFeature,
  readCommissionStatementPayAccess,
} from '../src/modules/identity/index.ts';
export { pendingCommissionEvents } from '../src/modules/commissions/index.ts';
export {
  employeeExistsInBusiness,
  lockEmployeeForUpdate,
  readCommissionBranchAttachments,
  readCommissionStatementEmployees,
  readEmployeeEmploymentDates,
} from '../src/modules/staff/index.ts';
export {
  businessCalendar,
  businessTimeZone,
  readCommissionBranchNames,
  commissionBranchNamesStatement,
} from '../src/modules/tenancy/index.ts';
export { readCommissionCustomerNames } from '../src/modules/customers/index.ts';

// A real API over a cloned database with real Better Auth sessions. Users are made the way an operator makes them,
// and every company goes through POST /v1/companies — the production path, never a raw insert.
const BASE = HARNESS_BASE;
const ORIGIN = HARNESS_ORIGIN;
const PASSWORD = 'operator-chosen-pass';

export interface Harness {
  readonly app: NestFastifyApplication;
  readonly owner: postgres.Sql;
  readonly auth: AuthService;
  readonly redis: Redis;
  readonly ownerUrl: string;
  readonly urls: {
    readonly app: string;
    readonly auth: string;
    readonly owner: string;
    readonly dispatcher: string;
  };
  /**
   * What reached the database boundary, in order: every wrapper entered (with its tenant or user) and every SQL
   * statement executed inside it — the isolation proof asserts on the statements, not only on the wrapper calls.
   * `withMember` records its company only after the membership proof, so a refused request records nothing.
   */
  readonly calls: {
    tenant: string[];
    user: string[];
    newTenant: string[];
    statements: { wrapper: 'tenant' | 'user' | 'new-tenant'; sql: string; params: unknown[] }[];
    /**
     * The mode PostgreSQL itself reports inside every `withMember` transaction that asked for a read-only
     * snapshot — read from the server, so a dropped option or a regressed wrapper shows up here.
     */
    memberSnapshots: { readOnly: string; isolation: string }[];
  };
  signedInOperator(email: string): Promise<string>;
  onboard(cookie: string, name: string): Promise<string>;
  send(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    options: {
      cookie: string;
      company?: string;
      key?: string;
      body?: object;
      headers?: Record<string, string>;
    },
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
            const compiled = dialect.sqlToQuery(query);
            calls.statements.push({ wrapper, sql: compiled.sql, params: compiled.params });
            return target.execute(query);
          }
        : Reflect.get(target, property, receiver),
  });
}

// The compose Redis (T2): REDIS_URL is required so local worktrees never fall back to shared 127.0.0.1:6379 (#1017).
// A key prefix per harness: rate-limit counters and pairing codes never leak between spec files or runs.
export function requireRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['REDIS_URL']?.trim();
  if (configured === undefined || configured === '') {
    throw new Error(
      'REDIS_URL is not set — set REDIS_URL to the test Redis instance (see docs/runbook.md)',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL with a hostname (#1017)');
  }
  if ((parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') || parsed.hostname === '') {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL with a hostname (#1017)');
  }
  return configured;
}

export function testRedis(env: NodeJS.ProcessEnv = process.env): Redis {
  return new Redis(requireRedisUrl(env), { keyPrefix: `test:${randomBytes(6).toString('hex')}:` });
}

// What the server says about the open transaction, not what the caller asked for.
async function transactionMode(tx: Tx): Promise<{ readOnly: string; isolation: string }> {
  const [row] = await tx.execute<{ readOnly: string; isolation: string }>(
    sql`SELECT current_setting('transaction_read_only') AS "readOnly",
      current_setting('transaction_isolation') AS "isolation"`,
  );
  return { readOnly: row?.readOnly ?? '', isolation: row?.isolation ?? '' };
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
    withMember: (userId, companyId, fn, options) =>
      database.withMember(
        userId,
        companyId,
        async (tx) => {
          calls.tenant.push(companyId);
          if (options?.readOnly === true) calls.memberSnapshots.push(await transactionMode(tx));
          return fn(recording(tx, 'tenant', calls));
        },
        options,
      ),
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
        ...(options.headers ?? {}),
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

const emptyCalls = (): Harness['calls'] => ({
  tenant: [],
  user: [],
  newTenant: [],
  statements: [],
  memberSnapshots: [],
});

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
      boundedTenantTransactions:
        options.staffOtpFactory !== undefined || options.staffPinResetFactory !== undefined,
    }),
    (value) => value.close(),
  );
  await database.ping();
  const redis = cleanup.own(testRedis(), (value) => value.quit());
  const calls = emptyCalls();
  const spiedDatabase = spied(database, calls);
  const wrappers = options.wrapDatabase?.(spiedDatabase) ?? spiedDatabase;
  const staffOtp = options.staffOtpFactory?.(auth, testDb.authUrl, wrappers, redis);
  if (staffOtp !== undefined) cleanup.own(staffOtp, (value) => value.close());
  const pinReset = options.staffPinResetFactory?.(auth, testDb.authUrl, wrappers, redis);
  if (pinReset !== undefined) cleanup.own(pinReset, (value) => value.close());
  const app = cleanup.own(
    await createApp(
      {
        readiness: [],
        auth: { service: auth, baseURL: BASE },
        employeeCardKey: testEmployeeCardKey,
        database: wrappers,
        ...optionalWiring(options),
        authTrustedOrigins: harnessAuthOrigins(options),
        ...(options.corsOrigins === undefined ? {} : { corsOrigins: options.corsOrigins }),
        ...staffWiring(options, staffOtp, auth),
        ...(pinReset === undefined ? {} : { staffPinReset: pinReset }),
        ...personalWiring(options, auth, database),
        ids,
        ...(options.omitRedis === true ? {} : { redis }),
      },
      {
        logger: harnessLogger(options),
        ...(options.controllers === undefined ? {} : { controllers: options.controllers }),
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
    urls: {
      app: testDb.appUrl,
      auth: testDb.authUrl,
      owner: testDb.ownerUrl,
      dispatcher: testDb.dispatcherUrl,
    },
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
