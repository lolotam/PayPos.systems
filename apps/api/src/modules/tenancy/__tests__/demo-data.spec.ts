import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PROVISIONAL_PLAN_ID, grantPlatformPermission } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDemoData, type DemoDependencies } from '../../../../scripts/demo-data.ts';
import { assertDevelopmentTarget } from '../../../../scripts/demo-guard.ts';
import { demoReads } from '../../../../scripts/demo-reads.ts';
import { startHarness, type Harness } from './harness.ts';

// Plan v4 T8: the demo data goes through the production routes — one company per vertical, each with its business
// of that vertical and one branch — only on a local development database, and a re-run completes what a failed run
// left out without creating anything twice.
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

const deps = (afterStep?: (step: string) => void): DemoDependencies => ({
  app: h.app,
  auth: h.auth,
  origin: 'http://admin.test',
  planId: PROVISIONAL_PLAN_ID,
  ...demoReads(h.owner),
  grant: async (email) => {
    const request = { email, permission: 'create:companies:platform', operator: 'demo-data' };
    await grantPlatformPermission(h.ownerUrl, request, systemUuidV7());
  },
  ...(afterStep === undefined ? {} : { afterStep }),
});

const demoRows = () => h.owner`
  SELECT c.name_en, b.vertical_type, count(br.id)::int AS branches
  FROM companies c
  JOIN businesses b ON b.company_id = c.id
  JOIN branches br ON br.company_id = b.company_id AND br.business_id = b.id
  WHERE c.name_en LIKE 'Demo %' GROUP BY 1, 2 ORDER BY 1`;

describe('demo data through the API', () => {
  it('a run that fails half-way is completed by the next one, without duplicates', async () => {
    const stop = (step: string) => {
      if (step === 'laundry:business') throw new Error('stopped for the test');
    };
    await expect(createDemoData(deps(stop))).rejects.toThrow(/stopped for the test/);
    // The first run committed restaurant and salon (3 + 3), then laundry's company and business before stopping:
    // the resume writes only laundry's branch and the two verticals after it.
    expect(await createDemoData(deps())).toBe(1 + 3 + 3);
    expect(await createDemoData(deps())).toBe(0);
    expect(await demoRows()).toEqual(
      ['laundry', 'restaurant', 'retail', 'salon', 'services'].map((v) => ({
        name_en: `Demo ${v[0]?.toUpperCase()}${v.slice(1)}`,
        vertical_type: v,
        branches: 1,
      })),
    );
    const events = await h.owner`
      SELECT event_type, count(*)::int AS n FROM outbox
      WHERE company_id IN (SELECT id FROM companies WHERE name_en LIKE 'Demo %') GROUP BY 1 ORDER BY 1`;
    expect(events).toEqual([
      { event_type: 'BranchCreated', n: 5 },
      { event_type: 'BusinessCreated', n: 5 },
      { event_type: 'CompanyCreated', n: 5 },
    ]);
  });
});

describe('demo data refuses anything but a local development database', () => {
  const local = 'postgres://u:p@127.0.0.1:5432/pospay';
  const env = {
    NODE_ENV: 'development',
    DATABASE_URL: local,
    AUTH_DATABASE_URL: local,
    MIGRATION_DATABASE_URL: local,
  };

  it('accepts one local database in development', () => {
    expect(() => assertDevelopmentTarget(env)).not.toThrow();
  });

  it.each([
    ['production', { ...env, NODE_ENV: 'production' }],
    ['a remote host', { ...env, DATABASE_URL: 'postgres://u:p@db.pospay.systems:5432/pospay' }],
    [
      'two different databases',
      { ...env, AUTH_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/other' },
    ],
    ['a missing connection', { ...env, MIGRATION_DATABASE_URL: '' }],
  ])('refuses %s', (_label, target) => {
    expect(() => assertDevelopmentTarget(target)).toThrow(/demo:seed/);
  });
});

describe('the real pnpm demo:seed command', () => {
  it('compiles, runs against a local database and completes the demo data', () => {
    const run = spawnSync('pnpm', ['run', 'demo:seed'], {
      cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: h.urls.app,
        AUTH_DATABASE_URL: h.urls.auth,
        MIGRATION_DATABASE_URL: h.urls.owner,
        REDIS_URL: 'redis://127.0.0.1:6379',
        BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-hmac',
        BETTER_AUTH_URL: 'http://api.test',
        AUTH_TRUSTED_ORIGINS: 'http://admin.test',
      },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/demo data complete; rows created this run: 0/);
  }, 180_000);
});
