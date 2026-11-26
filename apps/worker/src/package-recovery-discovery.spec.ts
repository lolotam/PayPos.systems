import { afterEach, expect, it, vi } from 'vitest';
import type { Logger } from '@pospay/observability';
import {
  discoverPackageRecoveries,
  startPackageRecoveryDiscovery,
} from './package-recovery-discovery.ts';
import type { PackageRecoveryTarget } from './modules/orders/index.ts';

const warn = vi.fn();
const logger = { warn } as unknown as Logger;
const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

afterEach(() => {
  warn.mockReset();
  vi.useRealTimers();
});

function pagesOf(ids: readonly string[]) {
  const cursors: (string | null)[] = [];
  const listCompanies = async (after: string | null, size: number) => {
    cursors.push(after);
    const start = after === null ? 0 : ids.indexOf(after) + 1;
    return ids.slice(start, start + size);
  };
  return { listCompanies, cursors };
}

function target(pending: ReadonlySet<string>, name = 'sale') {
  const registered: string[] = [];
  const value: PackageRecoveryTarget = {
    name,
    hasPending: async (id) => pending.has(id),
    register: async (id) => {
      registered.push(id);
    },
  };
  return { value, registered };
}

it('registers only the companies with a pending request, across several pages', async () => {
  const ids = Array.from({ length: 450 }, (_, i) => uuid(i + 1));
  const { listCompanies, cursors } = pagesOf(ids);
  const sale = target(new Set([ids[0] as string, ids[299] as string]));
  const imports = target(new Set([ids[449] as string]), 'import');
  const result = await discoverPackageRecoveries({
    listCompanies,
    targets: [sale.value, imports.value],
    logger,
  });
  expect(result).toEqual({ companies: 450, registered: 3, failures: 0 });
  expect(sale.registered).toEqual([ids[0], ids[299]]);
  expect(imports.registered).toEqual([ids[449]]);
  expect(cursors).toEqual([null, ids[199], ids[399]]);
});

it('keeps scanning after a company check or a registration fails and logs only the target name', async () => {
  const ids = [uuid(1), uuid(2), uuid(3)];
  const registered: string[] = [];
  const flaky: PackageRecoveryTarget = {
    name: 'sale',
    hasPending: async (id) => {
      if (id === ids[0]) throw new Error('select * from secret_table');
      return true;
    },
    register: async (id) => {
      if (id === ids[1]) throw new Error('redis://:password@host');
      registered.push(id);
    },
  };
  const result = await discoverPackageRecoveries({
    listCompanies: pagesOf(ids).listCompanies,
    targets: [flaky],
    logger,
  });
  expect(result).toEqual({ companies: 3, registered: 1, failures: 2 });
  expect(registered).toEqual([ids[2]]);
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenNthCalledWith(
    1,
    { company_id: ids[0], target: 'sale' },
    'package recovery discovery failed',
  );
  expect(warn).toHaveBeenNthCalledWith(
    2,
    { company_id: ids[1], target: 'sale' },
    'package recovery discovery failed',
  );
});

it('stops scanning between companies once stopped', async () => {
  const ids = [uuid(1), uuid(2), uuid(3)];
  const seen: string[] = [];
  const probe: PackageRecoveryTarget = {
    name: 'sale',
    hasPending: async (id) => {
      seen.push(id);
      return false;
    },
    register: async () => undefined,
  };
  const result = await discoverPackageRecoveries({
    listCompanies: pagesOf(ids).listCompanies,
    targets: [probe],
    logger,
    isStopped: () => seen.length >= 1,
  });
  expect(seen).toEqual([ids[0]]);
  expect(result.companies).toBe(1);
});

it('scans immediately without blocking, never overlaps two scans, and waits for the running scan on stop', async () => {
  vi.useFakeTimers();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  const loop = startPackageRecoveryDiscovery(
    {
      listCompanies: async (after) => {
        if (after === null) started += 1;
        await gate;
        return [];
      },
      targets: [],
      logger,
    },
    1000,
  );
  expect(started).toBe(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(started).toBe(1);
  let stopped = false;
  const stopping = loop.stop().then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(stopped).toBe(false);
  release();
  await stopping;
  expect(stopped).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(started).toBe(1);
});

it('logs a failed company listing and retries on the next tick', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const loop = startPackageRecoveryDiscovery(
    {
      listCompanies: async () => {
        calls += 1;
        if (calls === 1) throw new Error('connection string');
        return [];
      },
      targets: [],
      logger,
    },
    1000,
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toBe(2);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith({ target: 'companies' }, 'package recovery discovery failed');
  await loop.stop();
});
