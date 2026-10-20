import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionContext } from '@nestjs/common';
import type { Principal } from '@pospay/auth';
import type { TenantWrappers } from '@pospay/db';
import { expect, it } from 'vitest';

import { SelectedCompanyGuard } from '../selected-company.guard.ts';

const USER_ID = '01920000-0000-7000-8000-0000000000f1';
const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const CAPACITY = 3;
const REQUESTS = 50;

class CountingGate {
  active = 0;
  peak = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  async acquire(): Promise<void> {
    while (this.active >= this.capacity) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
  }

  release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}

function requestContext(principal: Principal): ExecutionContext {
  const request = {
    principal,
    headers: { 'x-company-id': COMPANY.toUpperCase() },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function countingDatabase(
  scope: AsyncLocalStorage<number>,
  gate: CountingGate,
): {
  database: TenantWrappers;
  total: () => number;
  nested: () => number;
} {
  const depth = new Map<number, number>();
  let total = 0;
  let nested = 0;
  const database = {
    withUser: (): Promise<unknown> => {
      throw new Error('withUser must not be called');
    },
    withTenant: (): Promise<unknown> => {
      throw new Error('withTenant must not be called');
    },
    withMember: async (
      userId: string,
      companyId: string,
      callback: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>,
    ) => {
      if (userId !== USER_ID) throw new Error('userId missing');
      if (companyId !== COMPANY) throw new Error('company id was not lower-cased');
      const requestId = scope.getStore();
      if (requestId === undefined) throw new Error('missing request scope');
      const held = depth.get(requestId) ?? 0;
      if (held > 0) nested += 1;
      depth.set(requestId, held + 1);
      await gate.acquire();
      total += 1;
      try {
        await Promise.resolve();
        return await callback({ execute: async () => [{ id: COMPANY }] });
      } finally {
        depth.set(requestId, held);
        gate.release();
      }
    },
  };
  return {
    database: database as unknown as TenantWrappers,
    total: () => total,
    nested: () => nested,
  };
}

it('uses one transaction per request and never holds two at once', async () => {
  const scope = new AsyncLocalStorage<number>();
  const gate = new CountingGate(CAPACITY);
  const db = countingDatabase(scope, gate);
  const guard = new SelectedCompanyGuard(db.database);
  const principal: Principal = {
    kind: 'user',
    userId: USER_ID,
    companyId: null,
    deviceId: null,
    employeeId: null,
    grants: [],
    memberships: [],
  };
  const results = await Promise.all(
    Array.from({ length: REQUESTS }, (_, index) =>
      scope.run(index, () => guard.canActivate(requestContext({ ...principal }))),
    ),
  );
  expect(results).toEqual(Array.from({ length: REQUESTS }, () => true));
  expect(db.total()).toBe(REQUESTS);
  expect(db.nested()).toBe(0);
  expect(gate.peak).toBeGreaterThan(1);
  expect(gate.peak).toBeLessThanOrEqual(CAPACITY);
});
