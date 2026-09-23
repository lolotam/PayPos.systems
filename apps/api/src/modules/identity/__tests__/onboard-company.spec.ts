import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createAuth, createPlatformUser, type AuthService } from '@pospay/auth';
import { errorEnvelope } from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { grantPlatformPermission } from '../../../../../../packages/db/src/platform-grants.ts';
import { PROVISIONAL_PLAN_ID, seedReferenceData } from '../../../../../../packages/db/src/seed.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createApp } from '../../../app.ts';

// T9a-4 scenarios ONB-01…04 (plan v4), through the API with real Better Auth sessions: users are created exactly
// as an operator creates them — platform:create-user, the one-time link, platform:grant — then sign in.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const PASSWORD = 'operator-chosen-pass';
const ids = systemUuidV7();

let testDb: TestDatabase;
let owner: postgres.Sql;
let auth: AuthService;
let database: Database;
let app: NestFastifyApplication;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedReferenceData(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  auth = await createAuth({
    databaseUrl: testDb.authUrl,
    secret: 'test-secret-that-is-long-enough-for-hmac',
    baseURL: BASE,
    trustedOrigins: [ORIGIN],
    ids,
    secureCookies: false,
    onLog: () => undefined,
  });
  database = createDatabase({ url: testDb.appUrl, ids });
  app = await createApp(
    { readiness: [], auth: { service: auth, baseURL: BASE }, database, ids },
    { logger: createLogger('silent') },
  );
});

afterAll(async () => {
  await app.close();
  await Promise.all([database.close(), auth.close()]);
  await owner.end();
  await testDb.drop();
});

const authPost = (path: string, payload: object, cookie?: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/auth${path}`,
    headers: { origin: ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
    payload,
  });

async function signedInUser(
  email: string,
  platform: boolean,
): Promise<{ id: string; cookie: string }> {
  const { userId, link } = await createPlatformUser(auth, {
    email,
    name: 'Operator',
    operator: 'test',
    redirectTo: `${ORIGIN}/set-password`,
  });
  const token = new URL(link).pathname.split('/').pop() ?? '';
  expect((await authPost('/reset-password', { token, newPassword: PASSWORD })).statusCode).toBe(
    200,
  );
  if (platform) {
    await grantPlatformPermission(
      testDb.ownerUrl,
      { email, permission: 'create:companies:platform', operator: 'test' },
      ids,
    );
  }
  const signIn = await authPost('/sign-in/email', { email, password: PASSWORD });
  const cookie = signIn.headers['set-cookie'];
  const cookies = (Array.isArray(cookie) ? cookie : [cookie ?? '']).map((c) => c.split(';')[0]);
  return { id: userId, cookie: cookies.join('; ') };
}

const createCompany = async (cookie: string, key: string, body: object) => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/companies',
    headers: { cookie, 'idempotency-key': key },
    payload: body,
  });
  return {
    status: res.statusCode,
    body: res.json() as Record<string, unknown>,
    text: res.body,
    headers: res.headers,
  };
};

const companyNamed = async (name: string) =>
  owner`SELECT id, owner_user_id FROM companies WHERE name_en = ${name}`;

describe('ONB-01 — the happy path', () => {
  it('writes the company, its owner membership, an audit row and CompanyCreated in one go', async () => {
    const operator = await signedInUser('onb01@example.test', true);
    const res = await createCompany(operator.cookie, 'onb-01', {
      name_en: 'Onb One',
      plan_id: PROVISIONAL_PLAN_ID,
    });
    expect(res.status).toBe(201);
    const companyId = res.body['id'] as string;
    expect(res.body).toMatchObject({ name_en: 'Onb One', owner_user_id: operator.id });
    const [membership] = await owner`
      SELECT user_id, role_id, scope_type, scope_id FROM memberships WHERE company_id = ${companyId}`;
    expect(membership).toMatchObject({
      user_id: operator.id,
      scope_type: 'COMPANY',
      scope_id: companyId,
    });
    const audit = await owner`SELECT action FROM audit_log WHERE company_id = ${companyId}`;
    expect(audit.map((r) => r['action'])).toEqual(['created']);
    const events = await owner`SELECT event_type FROM outbox WHERE company_id = ${companyId}`;
    expect(events.map((r) => r['event_type'])).toEqual(['CompanyCreated']);
  });

  it('refuses a caller without the platform grant, and an unknown plan without claiming the key', async () => {
    const plain = await signedInUser('plain@example.test', false);
    const body = { name_en: 'Nope', plan_id: PROVISIONAL_PLAN_ID };
    expect((await createCompany(plain.cookie, 'k-plain', body)).status).toBe(403);
    const operator = await signedInUser('plan@example.test', true);
    const unknown = await createCompany(operator.cookie, 'k-plan', {
      ...body,
      plan_id: ids.newId(),
    });
    expect([unknown.status, errorEnvelope.parse(unknown.body).code]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    expect((await createCompany(operator.cookie, 'k-plan', body)).status).toBe(201);
  });
});

describe('ONB-02 — a failed membership insert leaves nothing behind', () => {
  it('no company, no outbox event and no idempotency key when the owner membership cannot be written', async () => {
    const operator = await signedInUser('onb02@example.test', true);
    const before = await owner`SELECT count(*)::int AS n FROM outbox`;
    await owner`REVOKE INSERT ON memberships FROM pospay_app`;
    try {
      const res = await createCompany(operator.cookie, 'onb-02', {
        name_en: 'Onb Two',
        plan_id: PROVISIONAL_PLAN_ID,
      });
      expect(res.status).toBe(500);
    } finally {
      await owner`GRANT INSERT ON memberships TO pospay_app`;
    }
    expect(await companyNamed('Onb Two')).toHaveLength(0);
    expect(await owner`SELECT count(*)::int AS n FROM outbox`).toEqual(before);
    expect(await owner`SELECT 1 FROM idempotency_keys WHERE key = 'onb-02'`).toHaveLength(0);
  });
});

describe('ONB-03 — a replayed key', () => {
  it('returns the identical stored response and creates one company; a different body is 422', async () => {
    const operator = await signedInUser('onb03@example.test', true);
    const body = { name_en: 'Onb Three', plan_id: PROVISIONAL_PLAN_ID };
    const first = await createCompany(operator.cookie, 'onb-03', body);
    const again = await createCompany(operator.cookie, 'onb-03', body);
    // Byte for byte, not just equal objects: the first response is what the key stored.
    expect([again.status, again.text]).toEqual([first.status, first.text]);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await companyNamed('Onb Three')).toHaveLength(1);
    const reused = await createCompany(operator.cookie, 'onb-03', { ...body, name_en: 'Other' });
    expect([reused.status, errorEnvelope.parse(reused.body).code]).toEqual([
      422,
      'IDEMPOTENCY_KEY_REUSED',
    ]);
  });
});

describe('ONB-04 — two companies created through the API by two users', () => {
  it('each user owns exactly the company they created', async () => {
    const [first, second] = [
      await signedInUser('onb04a@example.test', true),
      await signedInUser('onb04b@example.test', true),
    ];
    const body = { plan_id: PROVISIONAL_PLAN_ID };
    const a = await createCompany(first.cookie, 'onb-04', { ...body, name_en: 'Onb Four A' });
    const b = await createCompany(second.cookie, 'onb-04', { ...body, name_en: 'Onb Four B' });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body['id']).not.toBe(b.body['id']);
    const owners = await owner`
      SELECT company_id, user_id FROM memberships WHERE company_id IN (${a.body['id'] as string}, ${b.body['id'] as string})
      ORDER BY company_id`;
    expect(owners.map((r) => [r['company_id'], r['user_id']]).sort()).toEqual(
      [
        [a.body['id'], first.id],
        [b.body['id'], second.id],
      ].sort(),
    );
  });
});
