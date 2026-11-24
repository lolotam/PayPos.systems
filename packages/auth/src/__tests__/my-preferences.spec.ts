import { randomUUID } from 'node:crypto';
import { createAuthDatabase, AuthUserNotFoundError } from '@pospay/db';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { createMyPreferences } from '../my-preferences.ts';

let fixture: TestDatabase;
let database: ReturnType<typeof createAuthDatabase>;
let owner: postgres.Sql;
let preferences: ReturnType<typeof createMyPreferences>;
const x = randomUUID(), y = randomUUID();

beforeAll(async () => {
  fixture = await createTestDatabase();
  owner = postgres(fixture.ownerUrl, { max: 1, onnotice: () => undefined });
  database = createAuthDatabase({ url: fixture.authUrl });
  preferences = createMyPreferences(database);
  await owner`INSERT INTO "user"(id,name,email) VALUES
    (${x},'X','x@preferences.invalid'),(${y},'Y','y@preferences.invalid')`;
});
afterAll(async () => {
  await database?.close();
  await owner?.end();
  await fixture?.drop();
});

it('reads unset, saves B, resets NULL and never modifies a second user', async () => {
  expect(await preferences.read(x)).toBeNull();
  expect(await preferences.write(x, 'B')).toBe('B');
  expect(await preferences.read(x)).toBe('B');
  expect(await preferences.read(y)).toBeNull();
  expect(await preferences.write(x, null)).toBeNull();
  expect(await preferences.read(x)).toBeNull();
});
it('throws a typed missing-user error on a write', async () => {
  await expect(preferences.write(randomUUID(), 'A')).rejects.toBeInstanceOf(AuthUserNotFoundError);
});
it('looks up one primary key on analysed representative data using the auth role', async () => {
  await owner`INSERT INTO "user"(id,name,email)
    SELECT gen_random_uuid(),'Synthetic', 'plan-' || n || '@preferences.invalid' FROM generate_series(1,10000) n`;
  await owner`ANALYZE "user"`;
  const connection = postgres(fixture.authUrl, { max: 1, onnotice: () => undefined });
  try {
    const plan = await connection`EXPLAIN (ANALYZE, FORMAT JSON) SELECT nav_style FROM "user" WHERE id=${x}::uuid`;
    expect(JSON.stringify(plan)).toContain('user_pkey');
    expect(JSON.stringify(plan)).toContain('Index Cond');
  } finally { await connection.end(); }
  expect(await preferences.read(y)).toBeNull();
});
