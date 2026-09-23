import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import templates from '../../seed/vertical-templates.json' with { type: 'json' };
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { FEATURE_FLAGS, seedReferenceData } from '../seed.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

describe('seedReferenceData', () => {
  it('writes one provisional plan with every module flag enabled, and is idempotent', async () => {
    await seedReferenceData(testDb.ownerUrl);
    await seedReferenceData(testDb.ownerUrl);
    const rows = await owner<{ code: string; feature_flags: Record<string, boolean> }[]>`
      SELECT code, feature_flags FROM plans`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('provisional');
    expect(rows[0]?.feature_flags).toEqual(Object.fromEntries(FEATURE_FLAGS.map((f) => [f, true])));
  });

  it('creates no company — an owner-less company is forbidden (ADR-0003 §5.3)', async () => {
    const [row] = await owner`SELECT count(*)::int AS n FROM companies`;
    expect(row).toEqual({ n: 0 });
  });
});

describe('vertical templates (PRD §7.1)', () => {
  it('cover exactly the verticals the businesses table accepts', () => {
    expect(Object.keys(templates.templates).sort()).toEqual([
      'laundry',
      'restaurant',
      'retail',
      'salon',
      'services',
    ]);
  });

  it('enable only modules that have a feature flag', () => {
    const known = new Set<string>(FEATURE_FLAGS);
    for (const template of Object.values(templates.templates)) {
      expect(template.modules.filter((module) => !known.has(module))).toEqual([]);
    }
  });
});
