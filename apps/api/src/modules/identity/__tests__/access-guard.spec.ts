import { Controller, Get, Req } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthService } from '@pospay/auth';
import { errorEnvelope } from '@pospay/contracts';
import {
  OWNER_ROLE_ID,
  SYSTEM_ROLES,
  createDatabase,
  type Database,
  type TenantPermission,
  type TenantWrappers,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import type { FastifyRequest } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedReferenceData } from '../../../../../../packages/db/src/seed.ts';
import { createApp } from '../../../app.ts';
import { Require, RequirePlatform, RequiresFeature } from '../../../shared/access.decorators.ts';

// T9a-2 against real Postgres: memberships decide which companies a user may switch to, the permission is
// evaluated at the route's target with DENY winning, and a disabled feature is refused.
const ids = systemUuidV7();
const [OWNER, VIEWER, STRANGER] = [ids.newId(), ids.newId(), ids.newId()];
const [A, B, C] = [ids.newId(), ids.newId(), ids.newId()];
const [BUSINESS, BRANCH_1, BRANCH_3, BRANCH_B] = [
  ids.newId(),
  ids.newId(),
  ids.newId(),
  ids.newId(),
];
const VIEWER_ROLE = SYSTEM_ROLES.find((role) => role.code === 'viewer')?.id ?? '';
const PROBE_BRANCH = 'read:probe:branch' as TenantPermission;

@Controller('probe/access')
class AccessProbe {
  @Require('read:memberships:company')
  @Get('company')
  company(@Req() request: FastifyRequest): { companyId: string | null | undefined } {
    return { companyId: request.principal?.companyId };
  }

  @Require(PROBE_BRANCH, { branch: 'branchId' })
  @Get('branches/:branchId')
  branch(): { ok: true } {
    return { ok: true };
  }

  @RequirePlatform('create:companies:platform')
  @Get('platform')
  platform(@Req() request: FastifyRequest): { companyId: string | null | undefined } {
    return { companyId: request.principal?.companyId };
  }

  @Require('read:memberships:company')
  @RequiresFeature('orders')
  @Get('orders')
  orders(): { ok: true } {
    return { ok: true };
  }
}

// The session is Better Auth's job (proven in packages/auth); here a cookie names the user and the session hint.
const SESSIONS: Record<string, { userId: string; hint: string | null; platform?: string[] }> = {
  owner: { userId: OWNER, hint: null },
  'owner-hint-a': { userId: OWNER, hint: A },
  viewer: { userId: VIEWER, hint: null },
  stranger: { userId: STRANGER, hint: null },
  operator: { userId: STRANGER, hint: null, platform: ['create:companies:platform'] },
};
const fakeAuth: AuthService = {
  handler: async () => new Response(null, { status: 404 }),
  getSession: async (headers) => {
    const session = SESSIONS[/sid=([\w-]+)/.exec(headers.get('cookie') ?? '')?.[1] ?? ''];
    return session === undefined
      ? null
      : {
          userId: session.userId,
          sessionId: ids.newId(),
          activeCompanyId: session.hint,
          platformPermissions: session.platform ?? [],
          setCookies: [],
        };
  },
  provisionUser: async () => OWNER,
  issuePasswordSetLink: async () => 'http://api.test/unused',
  recordPlatformAction: async () => undefined,
  discardUser: async () => undefined,
  ping: async () => undefined,
  close: async () => undefined,
};

let testDb: TestDatabase;
let owner: postgres.Sql;
let database: Database;
let app: NestFastifyApplication;
// Every company withTenant was entered for — the refusal must come before any of them (ADR-0003 §4.1).
const tenantCalls: string[] = [];

async function arrange(): Promise<void> {
  const plan = (await owner`SELECT id FROM plans WHERE code = 'provisional'`)[0]?.['id'] as string;
  for (const [id, email] of [
    [OWNER, 'owner@example.test'],
    [VIEWER, 'viewer@example.test'],
    [STRANGER, 'stranger@example.test'],
  ] as const) {
    await owner`INSERT INTO "user" (id, name, email) VALUES (${id}, 'U', ${email})`;
  }
  for (const company of [A, B, C]) {
    await owner`INSERT INTO companies (id, name_en, owner_user_id, plan_id) VALUES (${company}, 'Co', ${OWNER}, ${plan})`;
  }
  await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en) VALUES (${BUSINESS}, ${A}, 'retail', 'Shop')`;
  await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en) VALUES (${BUSINESS}, ${B}, 'retail', 'Shop B')`;
  for (const [branch, company] of [
    [BRANCH_1, A],
    [BRANCH_3, A],
    [BRANCH_B, B],
  ] as const) {
    await owner`INSERT INTO branches (id, company_id, business_id, name_en) VALUES (${branch}, ${company}, ${BUSINESS}, 'Br')`;
  }
  await owner`INSERT INTO permissions (code) VALUES (${PROBE_BRANCH})`;
}

const member = (
  userId: string,
  company: string,
  role: string,
  scope: [string, string],
  endsAt: string | null = null,
) =>
  owner`
    INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at, ends_at)
    VALUES (${company}, ${ids.newId()}, ${userId}, ${role}, 'global', ${scope[0]}, ${scope[1]},
            now() - interval '1 day', ${endsAt}::timestamptz)
    RETURNING id`.then((rows) => rows[0]?.['id'] as string);

const override = (
  company: string,
  membership: string,
  permission: string,
  effect: string,
  scope: [string, string],
  expiresAt: string | null = null,
) =>
  owner`
    INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason, granted_by, expires_at)
    VALUES (${company}, ${ids.newId()}, ${membership}, ${permission}, ${effect}, ${scope[0]}, ${scope[1]}, 'test', ${OWNER}, ${expiresAt}::timestamptz)
    RETURNING id`.then((rows) => rows[0]?.['id'] as string);

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedReferenceData(testDb.ownerUrl);
  await arrange();
  database = createDatabase({ url: testDb.appUrl, ids });
  const spied: TenantWrappers = {
    withUser: (userId, fn) => database.withUser(userId, fn),
    withNewTenant: (userId, fn) => database.withNewTenant(userId, fn),
    withTenant: (companyId, fn, options) => {
      tenantCalls.push(companyId);
      return database.withTenant(companyId, fn, options);
    },
  };
  app = await createApp(
    {
      readiness: [],
      auth: { service: fakeAuth, baseURL: 'http://api.test' },
      database: spied,
    },
    { controllers: [AccessProbe], logger: createLogger('silent') },
  );
});

afterAll(async () => {
  await app.close();
  await database.close();
  await owner.end();
  await testDb.drop();
});

const get = async (url: string, sid: string | null, company?: string) => {
  const res = await app.inject({
    method: 'GET',
    url,
    headers: {
      ...(sid === null ? {} : { cookie: `sid=${sid}` }),
      ...(company === undefined ? {} : { 'x-company-id': company }),
    },
  });
  const body = res.json() as Record<string, unknown>;
  return {
    status: res.statusCode,
    body,
    code: res.statusCode >= 400 ? errorEnvelope.parse(body).code : null,
  };
};

describe('company switching — only between the companies a user belongs to', () => {
  beforeAll(async () => {
    await member(OWNER, A, OWNER_ROLE_ID, ['COMPANY', A]);
    await member(OWNER, B, OWNER_ROLE_ID, ['COMPANY', B]);
  });

  it('an owner of A and B reaches both, each as the verified company', async () => {
    expect(await get('/v1/probe/access/company', 'owner', A)).toMatchObject({
      status: 200,
      body: { companyId: A },
    });
    expect(await get('/v1/probe/access/company', 'owner', B)).toMatchObject({
      status: 200,
      body: { companyId: B },
    });
  });

  it('a company the user has no membership in is 403, like a malformed or missing id', async () => {
    for (const company of [C, 'not-a-uuid', undefined]) {
      expect(await get('/v1/probe/access/company', 'owner', company)).toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });
    }
  });

  it('a company the user does not belong to is refused before withTenant is ever entered for it', async () => {
    tenantCalls.length = 0;
    expect(await get('/v1/probe/access/company', 'owner', C)).toMatchObject({ status: 403 });
    expect(tenantCalls).toEqual([]);
    await get('/v1/probe/access/company', 'owner', A);
    expect(tenantCalls).toContain(A);
  });

  it('the session hint selects a company only after the same membership check', async () => {
    expect(await get('/v1/probe/access/company', 'owner-hint-a')).toMatchObject({
      status: 200,
      body: { companyId: A },
    });
  });

  it('no session is 401; a session with no membership is 403', async () => {
    expect(await get('/v1/probe/access/company', null, A)).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(await get('/v1/probe/access/company', 'stranger', A)).toMatchObject({ status: 403 });
  });
});

describe('membership window and overrides', () => {
  it('an ended membership no longer opens the company', async () => {
    await member(
      STRANGER,
      B,
      OWNER_ROLE_ID,
      ['COMPANY', B],
      new Date(Date.now() - 1000).toISOString(),
    );
    expect(await get('/v1/probe/access/company', 'stranger', B)).toMatchObject({ status: 403 });
  });

  it("a DENY override beats the owner role's ALLOW; an expired DENY does not", async () => {
    const membership = await member(STRANGER, C, OWNER_ROLE_ID, ['COMPANY', C]);
    expect(await get('/v1/probe/access/company', 'stranger', C)).toMatchObject({ status: 200 });
    await override(
      C,
      membership,
      'read:memberships:company',
      'DENY',
      ['COMPANY', C],
      new Date(Date.now() - 1000).toISOString(),
    );
    expect(await get('/v1/probe/access/company', 'stranger', C)).toMatchObject({ status: 200 });
    await override(C, membership, 'read:memberships:company', 'DENY', ['COMPANY', C]);
    expect(await get('/v1/probe/access/company', 'stranger', C)).toMatchObject({ status: 403 });
  });
});

describe('evaluation at the branch target (PRD D-31)', () => {
  beforeAll(async () => {
    const membership = await member(VIEWER, A, VIEWER_ROLE, ['BUSINESS', BUSINESS]);
    await override(A, membership, PROBE_BRANCH, 'ALLOW', ['BUSINESS', BUSINESS]);
    await override(A, membership, PROBE_BRANCH, 'DENY', ['BRANCH', BRANCH_3]);
  });

  it('a business-wide ALLOW with a DENY on branch 3 permits branch 1 and refuses branch 3', async () => {
    expect(await get(`/v1/probe/access/branches/${BRANCH_1}`, 'viewer', A)).toMatchObject({
      status: 200,
    });
    expect(await get(`/v1/probe/access/branches/${BRANCH_3}`, 'viewer', A)).toMatchObject({
      status: 403,
    });
  });

  it("another company's branch, an unknown branch and a malformed id are the same 403", async () => {
    for (const branch of [BRANCH_B, ids.newId(), 'nope']) {
      expect(await get(`/v1/probe/access/branches/${branch}`, 'viewer', A)).toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });
    }
  });

  it('the viewer role itself grants nothing yet (TODO(spec) D-07)', async () => {
    expect(await get('/v1/probe/access/company', 'viewer', A)).toMatchObject({ status: 403 });
  });
});

describe('platform routes (ADR-0003 §3)', () => {
  it('only a platform grant opens them — no company is resolved, and a company owner is refused', async () => {
    expect(await get('/v1/probe/access/platform', 'operator')).toMatchObject({
      status: 200,
      body: { companyId: null },
    });
    expect(await get('/v1/probe/access/platform', 'owner', A)).toMatchObject({ status: 403 });
    expect(await get('/v1/probe/access/platform', null)).toMatchObject({ status: 401 });
  });

  it('a platform grant opens no company route', async () => {
    expect(await get('/v1/probe/access/company', 'operator', A)).toMatchObject({ status: 403 });
  });
});

describe('feature flags', () => {
  it('enabled by the plan, refused by an unexpired company override, back when it expires', async () => {
    expect(await get('/v1/probe/access/orders', 'owner', A)).toMatchObject({ status: 200 });
    await owner`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by) VALUES (${A}, 'orders', false, 'test', ${OWNER})`;
    expect(await get('/v1/probe/access/orders', 'owner', A)).toMatchObject({
      status: 403,
      code: 'FEATURE_DISABLED',
    });
    await owner`UPDATE company_feature_overrides SET expires_at = now() - interval '1 second' WHERE company_id = ${A}`;
    expect(await get('/v1/probe/access/orders', 'owner', A)).toMatchObject({ status: 200 });
  });
});

describe('an app without a database', () => {
  it('without a database no @Require route answers', async () => {
    const bare = await createApp(
      { readiness: [], auth: { service: fakeAuth, baseURL: 'http://api.test' } },
      { controllers: [AccessProbe], logger: createLogger('silent') },
    );
    try {
      const res = await bare.inject({
        method: 'GET',
        url: '/v1/probe/access/company',
        headers: { cookie: 'sid=owner', 'x-company-id': A },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await bare.close();
    }
  });
});
