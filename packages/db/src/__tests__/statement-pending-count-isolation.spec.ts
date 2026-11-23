import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eventId, pendingCountHarness, type Tx } from '../../test/statement-pending-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

// ADR-0012 §4 المجموعة 2 (CM-39): عزل المستأجرين حين تتداخل المعاملات وحين يُعاد استعمال اتصال بعد rollback.
const { A, B } = TENANT;

let test: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;
const { asApp, pending, seedEvent, clean } = pendingCountHarness(
  () => owner,
  () => app,
);

beforeAll(async () => {
  test = await createTestDatabase();
  await seedTwoTenants(test.ownerUrl);
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  app = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await app.end();
  await owner.end();
  await test.drop();
});

const backendPid = async (tx: Tx): Promise<number> =>
  (await tx`SELECT pg_backend_pid() AS pid`)[0]?.['pid'] as number;

describe('group 2: overlapping transactions on separate connections', () => {
  // كل معاملة تبقى مفتوحة حتى تدخل الأخرى؛ بلا هذا الحاجز قد تنتهي الأولى قبل أن تبدأ الثانية فلا يثبت التداخل.
  it('keeps each tenant count separate while both transactions are open at the same time', async () => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    await seedEvent(B.company, eventId(1), 'SalaryChanged');
    await seedEvent(B.company, eventId(2), 'SalaryChanged');
    const first = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
    const second = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
    let arrived = 0;
    let openTogether!: () => void;
    const bothOpen = new Promise<void>((resolve) => (openTogether = resolve));
    const run = (connection: postgres.Sql, company: string) =>
      connection.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${company}, true)`;
        const before = await pending(tx);
        arrived += 1;
        if (arrived === 2) openTogether();
        await bothOpen;
        const after = await pending(tx);
        const [context] = await tx`SELECT current_setting('app.company_id', true) AS company`;
        return { before, after, company: context?.['company'], pid: await backendPid(tx) };
      });

    try {
      const [forA, forB] = await Promise.all([run(first, A.company), run(second, B.company)]);

      expect(forA).toMatchObject({ before: '1', after: '1', company: A.company });
      expect(forB).toMatchObject({ before: '2', after: '2', company: B.company });
      expect(forA.pid).not.toBe(forB.pid);
    } finally {
      await first.end();
      await second.end();
    }
  });
});

describe('group 2: a connection reused after a rollback', () => {
  // set_config(..., true) يسقط مع المعاملة؛ هذا يثبت أن الاتصال نفسه لا يحمل سياق شركة سابقة بعد rollback متعمَّد.
  it('refuses the next call without a context after a rolled-back transaction held a valid one', async () => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    let heldPid = 0;

    await expect(
      asApp(A.company, async (tx) => {
        heldPid = await backendPid(tx);
        expect(await pending(tx)).toBe('1');
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    let reusedPid = 0;
    await expect(
      asApp(null, async (tx) => {
        reusedPid = await backendPid(tx);
        return pending(tx);
      }),
    ).rejects.toThrow('TENANT_CONTEXT_MISSING');

    expect(reusedPid).toBe(heldPid);
    expect(await asApp(B.company, (tx) => pending(tx))).toBe('0');
    expect(await asApp(A.company, (tx) => pending(tx))).toBe('1');
  });

  it('refuses a missing context after the function itself failed inside a valid-context transaction', async () => {
    await expect(asApp(A.company, (tx) => pending(tx, '2020-01-01 00:00:00+00'))).rejects.toThrow(
      'APPROVAL_CUTOFF_INVALID',
    );

    await expect(asApp(null, (tx) => pending(tx))).rejects.toThrow('TENANT_CONTEXT_MISSING');
  });
});
