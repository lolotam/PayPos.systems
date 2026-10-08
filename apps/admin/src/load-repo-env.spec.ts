// @vitest-environment node

import { loadEnvConfig, resetEnv } from '@next/env';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadRepoEnv } from '../load-repo-env';

let originalEnv: NodeJS.ProcessEnv;
let appDir: string;
let repoDir: string;

beforeEach(() => {
  originalEnv = { ...process.env };
  const adminDir = fileURLToPath(new URL('..', import.meta.url));
  appDir = mkdtempSync(join(adminDir, '.env-test-app-'));
  repoDir = mkdtempSync(join(adminDir, '.env-test-repo-'));
  vi.stubEnv('NODE_ENV', 'development');
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterEach(() => {
  resetEnv();
  vi.unstubAllEnvs();
  for (const key of Object.keys(process.env)) {
    if (originalEnv[key] === undefined) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  rmSync(appDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

it('loads the repository env after Next has cached an empty app env', () => {
  writeFileSync(join(repoDir, '.env'), 'NEXT_PUBLIC_API_URL=http://localhost:4321\n');

  loadEnvConfig(appDir, true, console, true);
  expect(process.env.NEXT_PUBLIC_API_URL).toBeUndefined();

  loadRepoEnv(repoDir);

  expect(process.env.NEXT_PUBLIC_API_URL).toBe('http://localhost:4321');
});

it.each(['.env.local', '.env.development'])(
  'keeps the app-level %s value over the root value',
  (file) => {
    writeFileSync(join(appDir, file), 'NEXT_PUBLIC_API_URL=http://localhost:4322\n');
    writeFileSync(join(repoDir, '.env'), 'NEXT_PUBLIC_API_URL=http://localhost:4321\n');
    const appEnv = loadEnvConfig(appDir, true, console, true);
    expect(process.env.NEXT_PUBLIC_API_URL).toBe('http://localhost:4322');

    loadRepoEnv(repoDir);

    expect(process.env.NEXT_PUBLIC_API_URL).toBe('http://localhost:4322');
    expect(loadEnvConfig(appDir).loadedEnvFiles).toBe(appEnv.loadedEnvFiles);
  },
);

it('keeps an app-level value when the root does not define it', () => {
  writeFileSync(join(appDir, '.env.local'), 'NEXT_PUBLIC_API_URL=http://localhost:4322\n');
  loadEnvConfig(appDir, true, console, true);

  loadRepoEnv(repoDir);

  expect(process.env.NEXT_PUBLIC_API_URL).toBe('http://localhost:4322');
});

it.each(['http://localhost:4323', ''])('keeps the process env value %j', (value) => {
  writeFileSync(join(repoDir, '.env'), 'NEXT_PUBLIC_API_URL=http://localhost:4321\n');
  loadEnvConfig(appDir, true, console, true);
  process.env.NEXT_PUBLIC_API_URL = value;

  loadRepoEnv(repoDir);

  expect(process.env.NEXT_PUBLIC_API_URL).toBe(value);
});

it.each([
  ['.env.development.local', '.env.local', '.env.development', '.env'],
  ['.env.local', '.env.development', '.env'],
  ['.env.development', '.env'],
])('prefers the root %s over lower-priority files', (...files) => {
  for (const [index, file] of files.entries()) {
    writeFileSync(join(repoDir, file), `NEXT_PUBLIC_API_URL=http://localhost:${4321 + index}\n`);
  }
  loadEnvConfig(appDir, true, console, true);

  loadRepoEnv(repoDir);

  expect(process.env.NEXT_PUBLIC_API_URL).toBe('http://localhost:4321');
});

it('expands root values using the app environment', () => {
  writeFileSync(join(appDir, '.env.local'), 'NEXT_PUBLIC_API_URL=http://localhost:4322\n');
  writeFileSync(join(repoDir, '.env'), 'POSPAY_ENV_TEST_URL="${NEXT_PUBLIC_API_URL}/v1"\n');
  delete process.env.POSPAY_ENV_TEST_URL;
  loadEnvConfig(appDir, true, console, true);

  loadRepoEnv(repoDir);

  expect(process.env.POSPAY_ENV_TEST_URL).toBe('http://localhost:4322/v1');
});

it('keeps production file selection and precedence', () => {
  loadEnvConfig(appDir, true, console, true);
  vi.stubEnv('NODE_ENV', 'production');
  writeFileSync(join(repoDir, '.env'), 'POSPAY_ENV_TEST_BASE=base\n');
  writeFileSync(join(repoDir, '.env.production'), 'POSPAY_ENV_TEST_MODE=production\n');
  writeFileSync(join(repoDir, '.env.local'), 'POSPAY_ENV_TEST_LOCAL=local\n');
  writeFileSync(join(repoDir, '.env.production.local'), 'NEXT_PUBLIC_API_URL=http://localhost:4324\n');
  writeFileSync(join(repoDir, '.env.development'), 'POSPAY_ENV_TEST_MODE=development\n');

  loadRepoEnv(repoDir);

  expect(process.env.NEXT_PUBLIC_API_URL).toBe('http://localhost:4324');
  expect(process.env.POSPAY_ENV_TEST_MODE).toBe('production');
  expect(process.env.POSPAY_ENV_TEST_LOCAL).toBe('local');
  expect(process.env.POSPAY_ENV_TEST_BASE).toBe('base');
});
