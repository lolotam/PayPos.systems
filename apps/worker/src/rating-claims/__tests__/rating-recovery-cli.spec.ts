import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../packages/db/test/test-database.ts';

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});
const company = '01920000-0000-7000-8000-0000000000aa';
const command = fileURLToPath(new URL('../../recover-rating-claims.ts', import.meta.url));

function run(extra: string[], redisUrl: string) {
  return spawnSync(process.execPath, ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', command, '--company', company, ...extra], {
    env: {
      ...process.env,
      DATABASE_URL: db.appUrl,
      DISPATCHER_DATABASE_URL: db.dispatcherUrl,
      REDIS_URL: redisUrl,
    },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

it('rejects inverted bounds before opening unavailable dependencies', () => {
  const result = run(
    ['--after', company, '--through', '01920000-0000-7000-8000-000000000001'],
    'redis://127.0.0.1:1',
  );
  expect(result.status).toBe(1);
  expect(result.stderr.trim()).toBe('REPLAY_SCOPE_INVALID');
  expect(result.stdout).toBe('');
});

it('exits with a clear bounded readiness failure when Redis cannot connect', () => {
  const result = run([], 'redis://127.0.0.1:1');
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr.trim()).toBe('RATING_CLAIMS_REDIS_READY_TIMEOUT');
  expect(result.stdout).toBe('');
});
