import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { boundedPostgres } from '../bounded-postgres.ts';
import { createOtpRuntime } from '../staff-otp-runtime.ts';

let test: TestDatabase, owner: postgres.Sql, pool: ReturnType<typeof boundedPostgres>;
beforeAll(async () => {
  test = await createTestDatabase();
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  pool = boundedPostgres(test.authUrl);
  await pool.warm();
});
it('the OTP idle timeout cannot close a transaction still inside its bounded operation window', async () => {
  const runtime = createOtpRuntime(test.authUrl, () => 0n);
  try {
    await runtime.warm();
    await expect(
      runtime.run(
        async (tx) => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          const [row] = await tx.execute<{ ready: number }>(sql`SELECT 1 AS ready`);
          return row?.ready;
        },
        new Date(Date.now() + 500),
      ),
    ).resolves.toBe(1);
  } finally {
    await runtime?.close();
  }
});
afterAll(async () => {
  await pool?.close();
  await owner?.end();
  await test?.drop();
});
it('a server-closed lease cannot schedule ROLLBACK on a missing socket; the next operation gets a fresh lease', async () => {
  await expect(
    pool.run(
      async (tx) => {
        const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        if (row === undefined) throw new Error('SYNTHETIC_BACKEND_MISSING');
        await owner`SELECT pg_terminate_backend(${row.pid})`;
        await new Promise((resolve) => setTimeout(resolve, 25));
        await tx.execute(sql`SELECT 1`);
      },
      new Date(Date.now() + 5000),
    ),
  ).rejects.toThrow();
  await new Promise((resolve) => setImmediate(resolve));
  expect(
    await pool.run(
      async (tx) => {
        const [row] = await tx.execute<{ ready: number }>(sql`SELECT 1 AS ready`);
        return row?.ready;
      },
      new Date(Date.now() + 5000),
    ),
  ).toBe(1);
});
