import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  createForUpdate,
  executeUpdate,
  employeeGrants,
  updateEmployeeFixture,
  type UpdateFixture,
} from './update-employee.fixture.ts';

let f: UpdateFixture;
beforeAll(async () => {
  f = await updateEmployeeFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('rechecks a target grant that expires while the employee lock is held', async () => {
  const record = await createForUpdate(f);
  await employeeGrants(f, [
    ['ALLOW', 'BRANCH', f.branch],
    ['ALLOW', 'BRANCH', f.sibling],
  ]);
  let signal!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = f.h.owner.begin(async (tx) => {
    await tx`SELECT id FROM employees WHERE company_id=${f.company} AND id=${record.id} FOR UPDATE`;
    signal();
    await ready;
    await tx`UPDATE permission_overrides SET expires_at=clock_timestamp() WHERE company_id=${f.company} AND membership_id=${f.memberId} AND scope_id=${f.sibling}`;
  });
  await locked;
  const request = executeUpdate(f, record, { branch_ids: [f.branch, f.sibling] }).catch(
    (error: unknown) => error,
  );
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await vi.waitFor(
      async () => {
        const waits =
          await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM employees%FOR UPDATE%'`;
        expect(waits.length).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 20 },
    );
  } finally {
    release();
    await writer;
    await observer.end();
  }
  expect(await request).toMatchObject({ message: 'FORBIDDEN' });
  expect(await f.h.owner`SELECT revision FROM employees WHERE id=${record.id}`).toEqual([
    { revision: 1 },
  ]);
  expect(
    await f.h.owner`SELECT id FROM employee_branches WHERE employee_id=${record.id}`,
  ).toHaveLength(1);
  expect(
    await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${record.id} AND action='updated'`,
  ).toHaveLength(0);
});

it('answers NOT_FOUND for a missing employee without waiting on the company lock', async () => {
  const record = await createForUpdate(f);
  let signal!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = f.h.owner.begin(async (tx) => {
    await tx`SELECT id FROM companies WHERE id=${f.company} FOR NO KEY UPDATE`;
    signal();
    await ready;
  });
  await locked;
  let timer: NodeJS.Timeout | undefined;
  try {
    const request = executeUpdate(f, { ...record, id: randomUUID() }).catch(
      (error: unknown) => error,
    );
    // مؤقت كاشف تعليق فقط: إن بقي الطلب منتظراً قفل الشركة المحجوز فلن يُنجز قبل انتهائه.
    const hang = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve('BLOCKED_ON_COMPANY_LOCK'), 3000);
    });
    expect(await Promise.race([request, hang])).toMatchObject({ message: 'NOT_FOUND' });
  } finally {
    clearTimeout(timer);
    release();
    await holder;
  }
});
