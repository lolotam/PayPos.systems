import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createLogger } from '@pospay/observability';
import { notClockedInDiagnostics } from '../persistence/not-clocked-in-diagnostics.ts';
import { ALERT_AT, SHIFT_START, notClockedInFixture, type NotClockedInFixture } from './not-clocked-in.fixture.ts';

let f: NotClockedInFixture;
beforeAll(async () => { f = await notClockedInFixture(); });
afterAll(async () => { await f?.close(); });

it('a noticed shift is excluded before any employee lock, including after a schedule re-save', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  const shift = await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  await f.removeShift(tenant.company, shift);
  await f.shift(tenant, employee);
  const run = vi.spyOn(f.transactions, 'run');
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(run).not.toHaveBeenCalled();
  run.mockRestore();
});

it('skips deleted companies before paging and rechecks deletion after an advisory page', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  const page = await f.transactions.candidates(tenant.company, SHIFT_START, ALERT_AT, null, 100);
  expect(page).toHaveLength(1);
  await f.closeCompany(tenant.company, ALERT_AT);
  expect(await f.transactions.candidates(tenant.company, SHIFT_START, ALERT_AT, null, 100)).toEqual([]);
  expect(await f.detect({ ...f.transactions, candidates: async () => page }).execute(tenant.company))
    .toEqual({ notified: 0 });
  expect(await f.notices(tenant.company, employee)).toHaveLength(0);
  expect(await f.events(tenant.company)).toHaveLength(0);
});

it('reports the cause of a repeated invalid timezone, keeps retrying, and processes other shifts', async () => {
  const tenant = await f.tenant();
  const bad = await f.employee(tenant);
  const good = await f.employee(tenant);
  await f.shift(tenant, bad);
  await f.shift(tenant, good);
  await f.owner`UPDATE staff_schedules SET timezone='Invalid/Synthetic' WHERE company_id=${tenant.company} AND employee_id=${bad}`;
  f.setNow(ALERT_AT);
  const before = f.failures.length;
  for (let run = 0; run < 2; run++) {
    await expect(f.detect().execute(tenant.company)).rejects.toThrow('ATTENDANCE_NOT_CLOCKED_IN_RETRY');
  }
  expect(f.failures.slice(before)).toHaveLength(2);
  expect(f.failures.slice(before).every((error) => error instanceof RangeError)).toBe(true);
  expect(await f.notices(tenant.company, bad)).toHaveLength(0);
  expect(await f.notices(tenant.company, good)).toHaveLength(1);
});

it('logs a finite diagnostic for the failure and cause without error messages or PII', () => {
  let output = '';
  const logger = createLogger('error', { destination: { write: (line) => { output += line; } } });
  const cause = Object.assign(new RangeError('private synthetic employee'), { code: 'secret-value' });
  notClockedInDiagnostics(logger).failed('01920000-0000-7000-8000-000000000001',
    new Error('private synthetic query', { cause }));
  expect(JSON.parse(output)).toMatchObject({
    code: 'ATTENDANCE_NOT_CLOCKED_IN_RETRY', failure: { type: 'Error' }, cause: { type: 'RangeError' },
  });
  expect(output).not.toMatch(/private|synthetic|secret-value/);
});
