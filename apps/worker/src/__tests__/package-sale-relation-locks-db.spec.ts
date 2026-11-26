import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Tx } from '@pospay/db';
import { lockPackageSeller } from '../modules/staff/index.ts';
import { packageSalePlace } from '../modules/tenancy/index.ts';
import {
  packageSaleFixture,
  type PackageSaleFixture,
} from '../modules/orders/__tests__/package-sale.fixture.ts';

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

/** يبقي معاملة التطبيق مفتوحة بعد تنفيذ القفل حتى الإفراج، ليختبر تعديل متزامن من اتصال آخر. */
function holdSaleLocks(lock: (tx: Tx) => Promise<unknown>) {
  let locked: () => void = () => undefined;
  const lockedPromise = new Promise<void>((resolve) => {
    locked = resolve;
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = f.database.withTenant(f.company, async (tx) => {
    await lock(tx);
    locked();
    await gate;
  });
  return { lockedPromise, release: () => release(), holding };
}

const TOUCH = {
  employees: (tx: typeof f.owner) =>
    tx`SELECT id FROM employees WHERE company_id=${f.company} AND id=${f.seller} FOR UPDATE`,
  employee_branches: (tx: typeof f.owner, branch: string) =>
    tx`SELECT id FROM employee_branches WHERE company_id=${f.company} AND employee_id=${f.seller} AND branch_id=${branch} FOR UPDATE`,
  branches: (tx: typeof f.owner, branch: string) =>
    tx`SELECT id FROM branches WHERE company_id=${f.company} AND id=${branch} FOR UPDATE`,
};

/** قفل FOR UPDATE يتعارض مع FOR SHARE ولا يمر على قيود التعديل؛ مهلة 300ms ترمي 55P03 لو القفل محتجز، فنفرّقه عن أي خطأ آخر. */
async function touchTimesOut(relation: keyof typeof TOUCH, branch: string): Promise<boolean> {
  try {
    await f.owner.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout='300ms'`;
      await TOUCH[relation](tx as unknown as typeof f.owner, branch);
    });
    return false;
  } catch (error) {
    expect((error as { code?: string }).code).toBe('55P03');
    return true;
  }
}

it('holds a share lock on the seller row and on the seller branch link until commit (#1037)', async () => {
  const held = holdSaleLocks((tx) =>
    lockPackageSeller(tx, f.company, f.business, f.branch, f.seller),
  );
  await held.lockedPromise;
  try {
    expect(await touchTimesOut('employees', f.branch)).toBe(true);
    expect(await touchTimesOut('employee_branches', f.branch)).toBe(true);
  } finally {
    held.release();
    await held.holding;
  }
  expect(await touchTimesOut('employee_branches', f.branch)).toBe(false);
  expect(await touchTimesOut('employees', f.branch)).toBe(false);
});

it('does not lock the link of another branch for the same seller (#1037)', async () => {
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.company},${f.ids.newId()},${f.business},${f.seller},${f.inactiveBranch},'2026-01-01',NULL)`;
  const held = holdSaleLocks((tx) =>
    lockPackageSeller(tx, f.company, f.business, f.branch, f.seller),
  );
  await held.lockedPromise;
  try {
    expect(await touchTimesOut('employee_branches', f.inactiveBranch)).toBe(false);
  } finally {
    held.release();
    await held.holding;
  }
});

it('holds a share lock on the selling branch row until commit and still reads its timezone (#1038)', async () => {
  let timezone: string | null = null;
  const held = holdSaleLocks(async (tx) => {
    timezone = await packageSalePlace(tx, f.company, f.business, f.branch);
  });
  await held.lockedPromise;
  try {
    expect(timezone).not.toBeNull();
    expect(await touchTimesOut('branches', f.branch)).toBe(true);
  } finally {
    held.release();
    await held.holding;
  }
  expect(await touchTimesOut('branches', f.branch)).toBe(false);
});

it('returns no place for an inactive branch without locking it (#1038)', async () => {
  await f.owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.inactiveBranch}`;
  let place: string | null = 'unset';
  const held = holdSaleLocks(async (tx) => {
    place = await packageSalePlace(tx, f.company, f.business, f.inactiveBranch);
  });
  await held.lockedPromise;
  try {
    expect(place).toBeNull();
    expect(await touchTimesOut('branches', f.inactiveBranch)).toBe(false);
  } finally {
    held.release();
    await held.holding;
  }
});
