// @vitest-environment node

import { loadEnvConfig, resetEnv } from '@next/env';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { loadRepoEnv } from '../load-repo-env';

it('loads the repository env after Next has cached an empty app env', () => {
  const originalEnv = { ...process.env };
  const adminDir = fileURLToPath(new URL('..', import.meta.url));
  const emptyDir = mkdtempSync(join(adminDir, '.env-test-empty-'));
  const dirWithEnv = mkdtempSync(join(adminDir, '.env-test-repo-'));

  try {
    writeFileSync(join(dirWithEnv, '.env'), 'NEXT_PUBLIC_API_URL=http://localhost:4321\n');
    delete process.env.NEXT_PUBLIC_API_URL;

    loadEnvConfig(emptyDir);
    expect(process.env.NEXT_PUBLIC_API_URL).toBeUndefined();

    loadRepoEnv(dirWithEnv);

    expect(process.env.NEXT_PUBLIC_API_URL).toBe('http://localhost:4321');
  } finally {
    resetEnv();
    Object.assign(process.env, originalEnv);
    rmSync(emptyDir, { recursive: true, force: true });
    rmSync(dirWithEnv, { recursive: true, force: true });
  }
});
