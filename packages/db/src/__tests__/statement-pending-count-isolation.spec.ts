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

interface OverlapResult {
  before: string;
  after: string;
  company: unknown;
  pid: number;
}

const backendPid = async (tx: Tx): Promise<number> =>
  (await tx`SELECT pg_backend_pid() AS pid`)[0]?.['pid'] as number;

/**
 * حاجز لطرفين قابل للإجهاض: يفتح حين يصل الطرفان، وإن فشل أحدهما قبل وصوله يُرفض الحاجز فيخرج الآخر بدل أن ينتظر للأبد.
 * بدون هذا يتحول فشل فرع واحد إلى تعليق ينتهي بمهلة CI لا برسالة الخطأ الأصلية.
 */
function abortableBarrier(parties: number) {
  let arrived = 0;
  let open!: () => void;
  let fail!: (reason: unknown) => void;
  const gate = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  gate.catch(() => undefined);
  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived === parties) open();
      await gate;
    },
    abort: (reason: unknown): void => fail(reason),
  };
}

describe('group 2: overlapping transactions on separate connections', () => {
  // كل معاملة تبقى مفتوحة حتى تدخل الأخرى؛ بلا هذا الحاجز قد تنتهي الأولى قبل أن تبدأ الثانية فلا يثبت التداخل.
  it('keeps each tenant count separate while both transactions are open at the same time', async () => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    await seedEvent(B.company, eventId(1), 'SalaryChanged');
    await seedEvent(B.company, eventId(2), 'SalaryChanged');
    const first = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
    const second = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
    const barrier = abortableBarrier(2);
    const run = (connection: postgres.Sql, company: string) =>
      connection
        .begin(async (tx) => {
          await tx`SELECT set_config('app.company_id', ${company}, true)`;
          const before = await pending(tx);
          await barrier.wait();
          const after = await pending(tx);
          const [context] = await tx`SELECT current_setting('app.company_id', true) AS company`;
          return { before, after, company: context?.['company'], pid: await backendPid(tx) };
        })
        .catch((error: unknown) => {
          barrier.abort(error);
          throw error;
        });

    // كلا الفرعين يستقران قبل إغلاق الاتصالين، ثم يُعاد أول خطأ كما هو.
    const settled = await Promise.allSettled([run(first, A.company), run(second, B.company)]);
    await Promise.all([first.end(), second.end()]);
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const [forA, forB] = settled.map(
      (result) => (result as PromiseFulfilledResult<OverlapResult>).value,
    );

    expect(forA).toMatchObject({ before: '1', after: '1', company: A.company });
    expect(forB).toMatchObject({ before: '2', after: '2', company: B.company });
    expect(forA?.pid).not.toBe(forB?.pid);
  });
});

describe('group 2: pooled calls on one backend', () => {
  // A ثم B يُثبَّتان على نفس الاتصال ثم نداء بلا سياق: يجب أن يفشل بدل أن يرث سياق الشركة الأخيرة.
  it('never counts another tenant, even with the same event id, and refuses a context-free call after A then B committed', async () => {
    await clean();
    await seedEvent(A.company, eventId(1), 'SalaryChanged');
    await seedEvent(B.company, eventId(1), 'SalaryChanged');
    await seedEvent(B.company, eventId(2), 'SalaryChanged');
    const pids: number[] = [];
    const counted = async (company: string | null) =>
      asApp(company, async (tx) => {
        pids.push(await backendPid(tx));
        return pending(tx);
      });

    expect(await counted(A.company)).toBe('1');
    expect(await counted(B.company)).toBe('2');
    await expect(counted(null)).rejects.toThrow('TENANT_CONTEXT_MISSING');
    expect(await counted(A.company)).toBe('1');
    expect(new Set(pids).size).toBe(1);
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
