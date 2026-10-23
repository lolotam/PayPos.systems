import { createECDH } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createAuth, type AuthOptions, type AuthService } from '@pospay/auth';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { phoneLockKey, vapidKeyId, type PushApiConfiguration } from '@pospay/notifications';
import type { Redis } from 'ioredis';
import postgres from 'postgres';

import { seedReferenceData } from '../../../../../../../packages/db/src/seed.ts';
import { createTestDatabase } from '../../../../../../../packages/db/test/test-database.ts';
import { createApp, type AppDependencies } from '../../../../app.ts';
import { createPersonalEligibility } from '../../../staff/index.ts';
import {
  adminCookie,
  adminOrigin,
  createSeedContext,
  issueSession,
  personalOrigin,
  receptionCookie,
  seedCompanyRows,
  seedEmployee,
  seedMembership,
  seedUser,
  type StaffSession,
} from './push-subscription.seed.ts';

export { adminOrigin, personalOrigin };
export type { StaffSession };

const BASE_URL = 'http://localhost:3000';

export const pushFixtureConfig: PushApiConfiguration = (() => {
  // مفتاح عام حقيقي من زوج مفاتيح P-256: نقطة على المنحنى، زي ما المتصفح بيطلبه.
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const publicKey = ecdh.getPublicKey().toString('base64url');
  return { publicKey, keyId: vapidKeyId(publicKey), subject: 'mailto:ops@pospay.systems' };
})();

export interface PushFixture {
  readonly app: NestFastifyApplication;
  readonly owner: postgres.Sql;
  readonly auth: AuthService;
  readonly ids: { newId(): string };
  readonly userId: string;
  readonly companyId: string;
  readonly config: PushApiConfiguration;
  readonly cookie: string;
  readonly headers: Record<string, string>;
  send(
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    options?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  adopt(session: StaffSession): void;
  primarySession(): Promise<StaffSession>;
  seedStaff(label: string): Promise<StaffSession>;
  seedCompany(label: string): Promise<StaffSession>;
  receptionCookie(): Promise<string>;
  adminCookie(): Promise<string>;
  close(): Promise<void>;
}

interface SessionState {
  current: StaffSession;
}

function authOptions(databaseUrl: string, ids: { newId(): string }): AuthOptions {
  return {
    staffPhoneLockKey: phoneLockKey,
    databaseUrl,
    secret: 'synthetic'.repeat(8),
    baseURL: BASE_URL,
    trustedOrigins: [personalOrigin, adminOrigin],
    ids,
    secureCookies: false,
    onLog: () => undefined,
  };
}

function appOptions(database: Database, auth: AuthService, configured: boolean): AppDependencies {
  return {
    readiness: [],
    auth: { service: auth, baseURL: BASE_URL },
    database,
    personal: {
      origin: personalOrigin,
      sessions: auth.personal,
      eligibility: createPersonalEligibility(database),
      otp: null,
    },
    push: configured ? pushFixtureConfig : null,
    redis: fakeRedis(),
  };
}

type FakeChain = {
  incr(name: string): FakeChain;
  expire(name: string): FakeChain;
  exec(): Promise<[Error | null, number][]>;
};

// Redis وهمي للاختبار: عدّاد نافذة ثابتة في الذاكرة. تسجيل الدفع محتاج حدّ يعدّ، وفي اختبار الـ API
// مفيش Redis حقيقي، فبلا عدّاد كل تسجيل بيرد NOT_READY وما بيفحصش ولا مفتاح.
function fakeRedis(): Redis {
  const store = new Map<string, string>();
  const multi = (): FakeChain => {
    const commands: (() => number)[] = [];
    const chain: FakeChain = {
      incr: (name: string) => {
        commands.push(() => {
          const next = Number(store.get(name) ?? '0') + 1;
          store.set(name, String(next));
          return next;
        });
        return chain;
      },
      expire: () => chain,
      exec: async () => commands.map((run) => [null, run()] as [Error | null, number]),
    };
    return chain;
  };
  return {
    multi,
    set: async (name: string, value: string) => {
      store.set(name, value);
      return 'OK';
    },
    get: async (name: string) => store.get(name) ?? null,
    ttl: async () => 3600,
  } as unknown as Redis;
}

// الـ payload بيتضاف بس لما يكون موجود، ونوعه string أو object عشان fastify يقبله.
async function sendRequest(
  app: NestFastifyApplication,
  state: SessionState,
  method: 'GET' | 'PUT' | 'POST',
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const injectOptions: {
    method: 'GET' | 'PUT' | 'POST';
    url: string;
    headers: Record<string, string>;
    payload?: string | object;
  } = {
    method,
    url,
    headers: { ...state.current.headers, ...(options.headers ?? {}) },
    ...(options.body === undefined ? {} : { payload: options.body as string | object }),
  };
  const response = await app.inject(injectOptions);
  return {
    status: response.statusCode,
    body: (response.body === '' ? {} : response.json()) as Record<string, unknown>,
  };
}

export async function pushFixture(options: { configured?: boolean } = {}): Promise<PushFixture> {
  const test = await createTestDatabase();
  await seedReferenceData(test.ownerUrl);
  const owner = postgres(test.ownerUrl, { max: 4, onnotice: () => undefined });
  const ids = systemUuidV7();
  const database = createDatabase({ url: test.appUrl, ids });
  const auth = await createAuth(authOptions(test.authUrl, ids));
  const seed = createSeedContext(owner, ids);
  const userId = await seedUser(seed, 'Synthetic staff', seed.nextPhone());
  const first = await seedCompanyRows(seed, 'Synthetic employer', userId);
  await seedEmployee(seed, 'Synthetic staff', userId, first);
  const app = await createApp(appOptions(database, auth, options.configured !== false));
  await app.getHttpAdapter().getInstance().ready();
  const state: SessionState = { current: await issueSession(auth, userId, first) };
  return {
    app,
    owner,
    auth,
    ids,
    userId,
    companyId: first.companyId,
    config: pushFixtureConfig,
    get cookie() {
      return state.current.cookie;
    },
    get headers() {
      return state.current.headers;
    },
    send: (method, url, request) => sendRequest(app, state, method, url, request),
    adopt: (value) => {
      state.current = value;
    },
    primarySession: async () => {
      state.current = await issueSession(auth, userId, first);
      return state.current;
    },
    seedStaff: async (label) => {
      const staffUserId = await seedUser(seed, label, seed.nextPhone());
      await seedEmployee(seed, label, staffUserId, first);
      await seedMembership(seed, first.companyId, staffUserId, first.branchId);
      return issueSession(auth, staffUserId, first);
    },
    seedCompany: async (label) => {
      const other = await seedCompanyRows(seed, label, userId);
      await seedEmployee(seed, 'Synthetic staff', userId, other);
      return issueSession(auth, userId, other);
    },
    receptionCookie: () => receptionCookie(seed, auth, userId, first),
    adminCookie: () => adminCookie(app, auth),
    close: async () => {
      await app.close();
      await auth.close();
      await database.close();
      await owner.end();
      await test.drop();
    },
  };
}
