import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Plan T9b / CLAUDE.md §8: only packages/auth hashes a password or a PIN, or talks to Better Auth. Every other package
// is refused the hashing libraries, the password-grade node:crypto functions and Better Auth itself — linted here with
// the API's real ESLint config.
const api = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: api });

async function errors(file: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: `${api}/${file}` });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.message);
}

describe('credential hashing belongs to packages/auth', () => {
  it.each([
    ["import bcrypt from 'bcrypt';\nexport const b = bcrypt;\n", 'bcrypt'],
    ["import argon2 from 'argon2';\nexport const a = argon2;\n", 'argon2'],
    ["import { scrypt } from 'node:crypto';\nexport const s = scrypt;\n", 'node:crypto scrypt'],
    ["import { pbkdf2Sync } from 'crypto';\nexport const p = pbkdf2Sync;\n", 'crypto pbkdf2Sync'],
    ["import { betterAuth } from 'better-auth';\nexport const b = betterAuth;\n", 'better-auth'],
    [
      "import { twoFactor } from 'better-auth/plugins';\nexport const t = twoFactor;\n",
      'better-auth/*',
    ],
  ])('refuses %s', async (source) => {
    const found = await errors('src/shared/probe.ts', source);
    expect(found.some((m) => m.includes('belong to packages/auth'))).toBe(true);
  });

  it('keeps ordinary crypto (a request fingerprint) allowed', async () => {
    const source = "import { createHash } from 'node:crypto';\nexport const h = createHash;\n";
    expect(await errors('src/shared/probe.ts', source)).toEqual([]);
  });

  it('refuses them inside use-cases/ too, whose own import rule would otherwise replace the ban', async () => {
    const source = "import bcrypt from 'bcrypt';\nexport const b = bcrypt;\n";
    const found = await errors('src/modules/identity/use-cases/probe/probe.ts', source);
    expect(found.length).toBeGreaterThan(0);
  });
});
