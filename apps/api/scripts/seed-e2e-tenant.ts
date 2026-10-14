import { createHmac, randomBytes } from 'node:crypto';

import { createAuth, createPlatformUser, type AuthService } from '@pospay/auth';
import { PROVISIONAL_PLAN_ID, SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface SeedTarget {
  readonly apiBase: string;
  readonly origin: string;
  readonly authUrl: string;
  readonly secret: string;
  readonly trusted: readonly string[];
  readonly migrationUrl: string;
}

export interface SeedUser {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly cookie: string;
}

export interface CatalogService {
  readonly id: string;
  readonly name: string;
  readonly price: string;
}

export interface CatalogEmployee {
  readonly id: string;
  readonly name: string;
}

export interface SeedTenant {
  readonly companyId: string;
  readonly companyName: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly services: readonly CatalogService[];
  readonly employees: readonly CatalogEmployee[];
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`e2e:seed needs ${name}`);
  return value;
}

export function readSeedTarget(env: NodeJS.ProcessEnv): SeedTarget {
  const trusted = required(env, 'AUTH_TRUSTED_ORIGINS')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const origin = trusted.find((item) => item.includes('://localhost:3001')) ?? trusted[0];
  if (origin === undefined) throw new Error('e2e:seed needs AUTH_TRUSTED_ORIGINS');
  return {
    apiBase: required(env, 'BETTER_AUTH_URL').replace(/\/$/u, ''),
    origin,
    authUrl: required(env, 'AUTH_DATABASE_URL'),
    secret: required(env, 'BETTER_AUTH_SECRET'),
    trusted,
    migrationUrl: required(env, 'MIGRATION_DATABASE_URL'),
  };
}

export function openAuth(target: SeedTarget): Promise<AuthService> {
  return createAuth({
    // Operator provisioning only; this script never opens a staff phone lock.
    staffPhoneLockKey: () => {
      throw new Error('STAFF_OPERATIONS_UNAVAILABLE');
    },
    databaseUrl: target.authUrl,
    secret: target.secret,
    baseURL: target.apiBase,
    trustedOrigins: target.trusted,
    ids: systemUuidV7(),
    secureCookies: target.apiBase.startsWith('https:'),
    onLog: () => undefined,
  });
}

function joinCookies(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((cookie) => cookie.includes('='))
    .join('; ');
}

function authPost(target: SeedTarget, path: string, body: object, cookie?: string): Promise<Response> {
  return fetch(`${target.apiBase}/v1/auth${path}`, {
    method: 'POST',
    headers: {
      origin: target.origin,
      'content-type': 'application/json',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

async function readBody(response: Response, path: string): Promise<Record<string, unknown>> {
  if (response.status >= 300) throw new Error(`seed ${response.status} ${path}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function provisionUser(
  auth: AuthService,
  target: SeedTarget,
  email: string,
  name: string,
): Promise<SeedUser> {
  const created = await createPlatformUser(auth, {
    email,
    name,
    operator: 'e2e-seed',
    redirectTo: `${target.origin}/set-password`,
  });
  const password = randomBytes(24).toString('base64url');
  const token = new URL(created.link).pathname.split('/').pop() ?? '';
  await readBody(
    await authPost(target, '/reset-password', { token, newPassword: password }),
    '/v1/auth/reset-password',
  );
  const signedIn = await authPost(target, '/sign-in/email', { email, password });
  if (signedIn.status >= 300) throw new Error(`seed ${signedIn.status} /v1/auth/sign-in/email`);
  const cookie = joinCookies(signedIn.headers);
  if (cookie === '') throw new Error('seed sign-in cookie missing');
  return { userId: created.userId, email, password, cookie };
}

function decodeBase32(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/u, '').replace(/ /gu, '').toUpperCase();
  let bits = '';
  for (const char of cleaned) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error('seed totp secret invalid');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, at: Date): string {
  const counter = Math.floor(at.getTime() / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = (hmac.at(-1) ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

export async function enrolTotp(target: SeedTarget, user: SeedUser): Promise<string> {
  const enabled = await readBody(
    await authPost(
      target,
      '/two-factor/enable',
      { password: user.password, method: 'totp' },
      user.cookie,
    ),
    '/v1/auth/two-factor/enable',
  );
  const uri = enabled['totpURI'];
  if (typeof uri !== 'string') throw new Error('seed totp uri missing');
  const secret = new URL(uri).searchParams.get('secret');
  if (secret === null || secret === '') throw new Error('seed totp secret missing');
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remaining < 5) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
  await readBody(
    await authPost(target, '/two-factor/verify-totp', { code: totpCode(secret, new Date()) }, user.cookie),
    '/v1/auth/two-factor/verify-totp',
  );
  return secret;
}

async function postJson(
  target: SeedTarget,
  path: string,
  cookie: string,
  companyId: string | undefined,
  body: object,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    cookie,
    origin: target.origin,
    'content-type': 'application/json',
    'idempotency-key': randomBytes(16).toString('hex'),
  };
  if (companyId !== undefined) headers['x-company-id'] = companyId;
  const response = await fetch(`${target.apiBase}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (response.status >= 300) throw new Error(`seed ${response.status} ${path}`);
  return (await response.json()) as Record<string, unknown>;
}

function idOf(body: Record<string, unknown>, path: string): string {
  const id = body['id'];
  if (typeof id !== 'string') {
    throw new Error(`seed id missing ${path} keys ${Object.keys(body).join(',')}`);
  }
  return id;
}

async function createServices(
  target: SeedTarget,
  cookie: string,
  companyId: string,
  businessId: string,
  label: string,
): Promise<CatalogService[]> {
  const priced = [
    ['Standard', '25.000'],
    ['Odd', '7.125'],
  ] as const;
  const services: CatalogService[] = [];
  for (const [kind, price] of priced) {
    const name = `E2E ${label} ${kind}`;
    const body = await postJson(target, `/v1/businesses/${businessId}/services`, cookie, companyId, {
      name_en: name,
      price,
      commission_rule: { kind: 'FOLLOW_PLAN' },
    });
    services.push({ id: idOf(body, '/v1/services'), name, price });
  }
  return services;
}

async function createEmployees(
  target: SeedTarget,
  cookie: string,
  companyId: string,
  businessId: string,
  branchId: string,
  label: string,
): Promise<CatalogEmployee[]> {
  const employees: CatalogEmployee[] = [];
  for (const person of ['Ada', 'Bea', 'Cleo', 'Dina']) {
    const name = `E2E ${label} ${person}`;
    const body = await postJson(target, `/v1/businesses/${businessId}/employees`, cookie, companyId, {
      primary_branch_id: branchId,
      name_en: name,
      role_code: 'staff',
      hire_date: '2026-01-01',
    });
    employees.push({ id: idOf(body, '/v1/employees'), name });
  }
  return employees;
}

export async function createTenant(
  target: SeedTarget,
  cookie: string,
  label: string,
  catalog: boolean,
): Promise<SeedTenant> {
  const companyName = `E2E ${label}`;
  const company = await postJson(target, '/v1/companies', cookie, undefined, {
    name_en: companyName,
    plan_id: PROVISIONAL_PLAN_ID,
  });
  const companyId = idOf(company, '/v1/companies');
  const business = await postJson(target, '/v1/businesses', cookie, companyId, {
    vertical_type: 'salon',
    name_en: `${companyName} Salon`,
  });
  const businessId = idOf(business, '/v1/businesses');
  const branchName = `${companyName} Branch`;
  const branch = await postJson(target, `/v1/businesses/${businessId}/branches`, cookie, companyId, {
    name_en: branchName,
  });
  const branchId = idOf(branch, '/v1/branches');
  const services = catalog ? await createServices(target, cookie, companyId, businessId, label) : [];
  const employees = catalog
    ? await createEmployees(target, cookie, companyId, businessId, branchId, label)
    : [];
  return { companyId, companyName, businessId, branchId, branchName, services, employees };
}

export async function insertBranchMembership(
  migrationUrl: string,
  row: {
    companyId: string;
    userId: string;
    roleCode: string;
    branchId: string;
    limitBps: number | null;
  },
): Promise<void> {
  const role = SYSTEM_ROLES.find((item) => item.code === row.roleCode);
  if (role === undefined) throw new Error('e2e:seed role missing');
  const sql = postgres(migrationUrl, { max: 1, onnotice: () => undefined });
  try {
    // No API creates a non-owner membership. The migration role inserts the row the API fixture inserts.
    await sql`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, limit_bps)
      VALUES (${row.companyId}, ${systemUuidV7().newId()}, ${row.userId}, ${role.id}, 'global', 'BRANCH', ${row.branchId}, ${row.limitBps})`;
  } finally {
    await sql.end();
  }
}
