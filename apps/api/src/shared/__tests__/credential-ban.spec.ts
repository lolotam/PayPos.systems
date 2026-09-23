import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Plan T9b / CLAUDE.md §8: only packages/auth hashes a password or a PIN, or talks to Better Auth. Every other package
// is refused the hashing libraries, the password-grade node:crypto functions and Better Auth itself — in every import
// form — linted here with the API's and the worker's real ESLint configs.
const api = fileURLToPath(new URL('../../..', import.meta.url));
const worker = fileURLToPath(new URL('../../../../worker', import.meta.url));
const linters = { api: new ESLint({ cwd: api }), worker: new ESLint({ cwd: worker }) };

async function errors(file: string, source: string, app: 'api' | 'worker' = 'api') {
  const root = app === 'api' ? api : worker;
  const [result] = await linters[app].lintText(source, { filePath: `${root}/${file}` });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.message);
}
const banned = (messages: string[]) =>
  messages.some((m) => /belong to packages\/auth|restricted from being used/.test(m));
const lines = (...parts: string[]) => `${parts.join('\n')}\n`;

describe('credential hashing belongs to packages/auth', () => {
  it.each([
    ['bcrypt', lines("import bcrypt from 'bcrypt';", 'export const b = bcrypt;')],
    ['argon2', lines("import argon2 from 'argon2';", 'export const a = argon2;')],
    [
      'node:crypto scrypt',
      lines("import { scrypt } from 'node:crypto';", 'export const s = scrypt;'),
    ],
    [
      'crypto pbkdf2Sync',
      lines("import { pbkdf2Sync } from 'crypto';", 'export const p = pbkdf2Sync;'),
    ],
    [
      'node:crypto argon2Sync',
      lines("import { argon2Sync } from 'node:crypto';", 'export const a = argon2Sync;'),
    ],
    [
      'a default crypto import',
      lines("import crypto from 'node:crypto';", 'export const c = crypto;'),
    ],
    [
      'a namespace crypto import',
      lines("import * as crypto from 'crypto';", 'export const c = crypto;'),
    ],
    [
      '@noble/hashes pbkdf2',
      lines("import { pbkdf2 } from '@noble/hashes/pbkdf2.js';", 'export const p = pbkdf2;'),
    ],
    [
      'better-auth',
      lines("import { betterAuth } from 'better-auth';", 'export const b = betterAuth;'),
    ],
    [
      'better-auth/*',
      lines("import { twoFactor } from 'better-auth/plugins';", 'export const t = twoFactor;'),
    ],
    ['a dynamic import of node:crypto', lines("export const load = () => import('node:crypto');")],
    ['a dynamic import of bcrypt', lines("export const load = () => import('bcrypt');")],
  ])('refuses %s', async (_label, source) => {
    expect(banned(await errors('src/shared/probe.ts', source))).toBe(true);
  });
});

describe('the credential ban has no gaps', () => {
  it('keeps ordinary crypto (a request fingerprint) allowed', async () => {
    const source = lines(
      "import { createHash } from 'node:crypto';",
      'export const h = createHash;',
    );
    expect(await errors('src/shared/probe.ts', source)).toEqual([]);
  });

  it.each([
    lines("import { scryptSync } from 'crypto';", 'export const s = scryptSync;'),
    lines("import bcrypt from 'bcrypt';", 'export const b = bcrypt;'),
  ])('refuses them inside use-cases/ too, with the credential message: %s', async (source) => {
    const found = await errors('src/modules/identity/use-cases/probe/probe.ts', source);
    expect(found.some((m) => m.includes('belong to packages/auth'))).toBe(true);
  });

  it('refuses them in the worker too', async () => {
    const source = lines(
      "import { scryptSync } from 'node:crypto';",
      'export const s = scryptSync;',
    );
    expect(banned(await errors('src/probe.ts', source, 'worker'))).toBe(true);
  });
});
