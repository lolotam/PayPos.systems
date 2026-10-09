import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { applyMigrations } from '../concurrent-migrations.ts';

const files = vi.hoisted(() => ({
  sql: [] as string[],
  later: undefined as string[] | undefined,
  timestamp: 9_999_999_999_998,
}));
vi.mock('drizzle-orm/migrator', () => ({
  readMigrationFiles: () => [
    { sql: files.sql, folderMillis: files.timestamp, hash: 'test-migration' },
    ...(files.later === undefined
      ? []
      : [{ sql: files.later, folderMillis: files.timestamp + 1, hash: 'test-migration-later' }]),
  ],
}));
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
beforeEach(async () => {
  files.later = undefined;
  await owner`DELETE FROM drizzle.__drizzle_migrations WHERE hash IN ('test-migration', 'test-migration-later')`;
});

it('concurrent prefix survives failure, transactional suffix rolls back and a restart journals exactly once', async () => {
  await owner`CREATE TABLE notification_migration_test (id int)`;
  const prefix = [
    'DROP INDEX CONCURRENTLY IF EXISTS notification_migration_test_idx',
    'CREATE INDEX CONCURRENTLY notification_migration_test_idx ON notification_migration_test(id)',
  ];
  files.sql = [
    ...prefix,
    'ALTER TABLE notification_migration_test ADD COLUMN value int',
    'SELECT missing_test_function()',
  ];
  await expect(applyMigrations(owner, 'unused')).rejects.toThrow();
  expect(
    await owner`SELECT 1 FROM pg_indexes WHERE indexname = 'notification_migration_test_idx'`,
  ).toHaveLength(1);
  expect(
    await owner`SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_migration_test' AND column_name = 'value'`,
  ).toHaveLength(0);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(0);
  files.sql = [...prefix, 'ALTER TABLE notification_migration_test ADD COLUMN value int'];
  await applyMigrations(owner, 'unused');
  await applyMigrations(owner, 'unused');
  expect(
    await owner`SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_migration_test' AND column_name = 'value'`,
  ).toHaveLength(1);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(1);
});

it('runs de-duplicated data steps in marker order before the concurrent prefix and suffix', async () => {
  await owner`CREATE TABLE data_step_order_test (id int)`;
  const calls: string[] = [];
  const first = vi.fn(async (client: postgres.Sql) => {
    expect(await client`SELECT * FROM data_step_order_test`).toHaveLength(0);
    expect(
      await client`SELECT 1 FROM pg_indexes WHERE indexname = 'data_step_order_idx'`,
    ).toHaveLength(0);
    calls.push('first');
  });
  files.sql = [
    '-- pospay:data-step first\nCREATE INDEX CONCURRENTLY data_step_order_idx ON data_step_order_test(id)',
    '-- pospay:data-step second\n-- pospay:data-step first\nINSERT INTO data_step_order_test VALUES (1)',
  ];
  await applyMigrations(owner, 'unused', {
    first,
    second: async () => {
      calls.push('second');
    },
  });
  expect(first).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(['first', 'second']);
  expect(await owner`SELECT id FROM data_step_order_test`).toEqual([{ id: 1 }]);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(1);
});

it('rejects an unknown marker before any step, statement or journal row', async () => {
  files.sql = [
    '-- pospay:data-step known\nCREATE TABLE data_step_unknown_test (id int)',
    '-- pospay:data-step missing\nSELECT 1',
  ];
  const known = vi.fn(async () => undefined);
  await expect(applyMigrations(owner, 'unused', { known })).rejects.toThrow(
    'Unknown migration data step missing; migration aborted',
  );
  expect(known).not.toHaveBeenCalled();
  expect(await owner`SELECT to_regclass('data_step_unknown_test') AS relation`).toEqual([
    { relation: null },
  ]);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(0);
});

it.each([
  ['-- pospay:data-step missing', 'Unknown migration data step missing; migration aborted'],
  ['  -- pospay:data-step known', 'Malformed migration data step marker; migration aborted'],
])(
  'rejects a bad marker in a later pending migration before the earlier one runs (%s)',
  async (marker, message) => {
    files.sql = [
      '-- pospay:data-step known\nCREATE INDEX CONCURRENTLY data_step_pending_idx ON companies(id)',
      'CREATE TABLE data_step_pending_test (id int)',
    ];
    files.later = [`${marker}\nSELECT 1`];
    const known = vi.fn(async () => undefined);
    await expect(applyMigrations(owner, 'unused', { known })).rejects.toThrow(message);
    expect(known).not.toHaveBeenCalled();
    expect(await owner`SELECT to_regclass('data_step_pending_test') AS relation`).toEqual([
      { relation: null },
    ]);
    expect(
      await owner`SELECT 1 FROM pg_indexes WHERE indexname = 'data_step_pending_idx'`,
    ).toHaveLength(0);
    expect(
      await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash IN ('test-migration', 'test-migration-later')`,
    ).toHaveLength(0);
  },
);

it('leaves statements and the journal untouched when a data step throws', async () => {
  await owner`CREATE TABLE data_step_failure_test (id int)`;
  files.sql = [
    '-- pospay:data-step fails\nCREATE INDEX CONCURRENTLY data_step_failure_idx ON data_step_failure_test(id)',
    'INSERT INTO data_step_failure_test VALUES (1)',
  ];
  await expect(
    applyMigrations(owner, 'unused', {
      fails: async () => {
        throw new Error('Synthetic data step failure');
      },
    }),
  ).rejects.toThrow('Synthetic data step failure');
  expect(await owner`SELECT * FROM data_step_failure_test`).toHaveLength(0);
  expect(
    await owner`SELECT 1 FROM pg_indexes WHERE indexname = 'data_step_failure_idx'`,
  ).toHaveLength(0);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(0);
});

it.each([
  '-- pospay:data-step employee_name_keys',
  '-- pospay:data-step Employee-name-keys',
  '-- pospay:data-step',
  '--POSPAY:DATA-STEP employee_name_keys',
  '  -- pospay:data-step known',
  '\t-- pospay:data-step known',
  '--pospay:data-step known',
  '--  pospay:data-step known',
  '-- pospay:data-step  known',
  '-- pospay:data-step known ',
  '-- pospay:data-step known -- trailing note',
  '/* pospay:data-step known */',
  '/*\n-- pospay:data-step known */',
  'SELECT 1; -- pospay:data-step known',
])('rejects malformed marker %s before any step, statement or journal row', async (marker) => {
  files.sql = [
    '-- pospay:data-step known\nCREATE TABLE data_step_malformed_test (id int)',
    `${marker}\nSELECT 1`,
  ];
  const known = vi.fn(async () => undefined);
  await expect(applyMigrations(owner, 'unused', { known })).rejects.toThrow(
    'Malformed migration data step marker; migration aborted',
  );
  expect(known).not.toHaveBeenCalled();
  expect(await owner`SELECT to_regclass('data_step_malformed_test') AS relation`).toEqual([
    { relation: null },
  ]);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(0);
});

it('aborts before statements and journaling when a data step replaces the locked session', async () => {
  await owner`CREATE TABLE data_step_session_test (id int)`;
  files.sql = [
    '-- pospay:data-step reconnect\nCREATE INDEX CONCURRENTLY data_step_session_idx ON data_step_session_test(id)',
    'INSERT INTO data_step_session_test VALUES (1)',
  ];
  const killer = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(
      applyMigrations(owner, 'unused', {
        reconnect: async (client) => {
          const [original] = await client<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          if (original === undefined) throw new Error('Missing migration session');
          await killer`SELECT pg_terminate_backend(${original.pid}, 5000)`;
          await expect
            .poll(async () => {
              try {
                const [current] = await client<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
                return current?.pid !== undefined && current.pid !== original.pid;
              } catch {
                return false;
              }
            })
            .toBe(true);
        },
      }),
    ).rejects.toThrow('Migration session lost its advisory lock; aborting');
    expect(await owner`SELECT * FROM data_step_session_test`).toHaveLength(0);
    expect(
      await owner`SELECT 1 FROM pg_indexes WHERE indexname = 'data_step_session_idx'`,
    ).toHaveLength(0);
    expect(
      await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
    ).toHaveLength(0);
  } finally {
    await killer.end();
  }
});

it('never runs or resolves data steps for an already journaled migration', async () => {
  files.sql = ['-- pospay:data-step once\nSELECT 1'];
  const once = vi.fn(async () => undefined);
  await applyMigrations(owner, 'unused', { once });
  once.mockClear();
  await applyMigrations(owner, 'unused', { once });
  await applyMigrations(owner, 'unused');
  expect(once).not.toHaveBeenCalled();
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(1);
});
