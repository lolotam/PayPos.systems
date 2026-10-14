import { randomBytes } from 'node:crypto';

import { createAuth, createPlatformUser, type AuthService } from '@pospay/auth';
import { systemUuidV7 } from '@pospay/ids';
import { joinCookies } from '../../admin/e2e/http-cookie.ts';
import { freshTotp } from '../../admin/e2e/totp.ts';

import { assertE2eTarget } from './seed-e2e-guard.ts';

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

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`e2e:seed needs ${name}`);
  return value;
}

export function readSeedTarget(env: NodeJS.ProcessEnv): SeedTarget {
  assertE2eTarget(env);
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
  await readBody(
    await authPost(target, '/two-factor/verify-totp', { code: await freshTotp(secret) }, user.cookie),
    '/v1/auth/two-factor/verify-totp',
  );
  return secret;
}

export async function postJson(
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

export function idOf(body: Record<string, unknown>, path: string): string {
  const id = body['id'];
  if (typeof id !== 'string') throw new Error(`seed id missing ${path}`);
  return id;
}
