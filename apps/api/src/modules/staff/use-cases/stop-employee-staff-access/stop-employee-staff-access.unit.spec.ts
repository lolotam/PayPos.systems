import { expect, it } from 'vitest';

import { StaffAccessError } from '../../domain/errors.ts';
import type { StaffAccessRecordRow } from '../../domain/staff-access.ts';
import type {
  StaffAccessEmployeeRow,
  StopEmployeeStaffAccessScope,
  StopEmployeeStaffAccessSteps,
} from '../../ports/staff-access.port.ts';
import { StopEmployeeStaffAccessUseCase } from './stop-employee-staff-access.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000c1';
const BUSINESS = '01920000-0000-7000-8000-0000000000b1';
const BRANCH = '01920000-0000-7000-8000-0000000000b2';
const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
const STAFF_USER = '01920000-0000-7000-8000-0000000000a1';
const ACTOR = '01920000-0000-7000-8000-0000000000d1';

const EMPLOYEE_ROW: StaffAccessEmployeeRow = {
  id: EMPLOYEE,
  businessId: BUSINESS,
  primaryBranchId: BRANCH,
  userId: STAFF_USER,
  displayName: 'Sara',
};
const ACTIVE: StaffAccessRecordRow = {
  id: '01920000-0000-7000-8000-0000000000a2',
  state: 'ACTIVE',
  roleCode: 'staff',
  branchId: BRANCH,
  operationId: '01920000-0000-7000-8000-0000000000a3',
  userId: STAFF_USER,
  membershipId: '01920000-0000-7000-8000-0000000000a4',
  attemptId: '01920000-0000-7000-8000-0000000000a5',
  attemptStartedAt: new Date('2026-11-25T00:00:00.000Z'),
  phoneHash: 'a'.repeat(64),
};

/** العالم المزيف: ما اتكتب وما اتنادى عليه بالترتيب. */
interface World {
  employee: StaffAccessEmployeeRow | null;
  record: StaffAccessRecordRow | null;
  authority: boolean;
  companyExists: boolean;
  order: string[];
  stopped: { recordId: string; userId: string; membershipId: string }[];
  sessionsEnded: { operationId: string; companyId: string; userId: string }[];
  invalidated: { companyId: string; membershipId: string }[];
  sessionsFail: boolean;
  cacheFails: boolean;
}

const worldOf = (overrides: Partial<World> = {}): World => ({
  employee: EMPLOYEE_ROW,
  record: ACTIVE,
  authority: true,
  companyExists: true,
  order: [],
  stopped: [],
  sessionsEnded: [],
  invalidated: [],
  sessionsFail: false,
  cacheFails: false,
  ...overrides,
});

function scopeOf(world: World): StopEmployeeStaffAccessScope {
  return {
    lockCompany: async () => world.companyExists,
    lock: async () => {
      world.order.push('lock');
      return { employee: world.employee, record: world.record };
    },
    authority: async () => {
      world.order.push('authority');
      return world.authority;
    },
    stop: async (input) => {
      world.order.push('stop');
      world.stopped.push(input);
    },
  };
}

async function run(world: World, userId = ACTOR) {
  const steps: StopEmployeeStaffAccessSteps = {
    run: async (_actor, _input, work) => {
      world.order.push('begin');
      const result = await work(scopeOf(world));
      world.order.push('commit');
      return result;
    },
  };
  const useCase = new StopEmployeeStaffAccessUseCase(
    steps,
    {
      deleteSessions: async (input) => {
        world.order.push('sessions');
        world.sessionsEnded.push(input);
        if (world.sessionsFail) throw new Error('AUTH_DOWN');
      },
    },
    {
      invalidate: async (input) => {
        world.order.push('cache');
        world.invalidated.push(input);
        if (world.cacheFails) throw new Error('REDIS_DOWN');
      },
    },
    { now: () => new Date('2026-11-25T00:00:00.000Z') },
    { newId: () => '01920000-0000-7000-8000-0000000000ff' },
  );
  const result = await useCase.execute({
    companyId: COMPANY,
    userId,
    businessId: BUSINESS,
    employeeId: EMPLOYEE,
  });
  return { result, world };
}

it('F3-2 stops inside one transaction, then ends the sessions and the cache after the commit', async () => {
  const { result, world } = await run(worldOf());
  expect(result).toEqual({ role: 'staff', branchId: BRANCH });
  expect(world.order).toEqual([
    'begin', 'lock', 'authority', 'stop', 'commit', 'sessions', 'cache',
  ]);
  expect(world.stopped).toEqual([
    { recordId: ACTIVE.id, userId: STAFF_USER, membershipId: ACTIVE.membershipId },
  ]);
  expect(world.sessionsEnded).toEqual([
    { operationId: ACTIVE.operationId, companyId: COMPANY, userId: STAFF_USER },
  ]);
  expect(world.invalidated).toEqual([{ companyId: COMPANY, membershipId: ACTIVE.membershipId }]);
});

it.each([
  ['a caller without authority', worldOf({ authority: false })],
  ['an unlinked employee', worldOf({ employee: { ...EMPLOYEE_ROW, userId: null } })],
  ['an employee with no access record', worldOf({ record: null })],
  ['a record bound to another user', worldOf({ record: { ...ACTIVE, userId: ACTOR } })],
  ['a PENDING record', worldOf({ record: { ...ACTIVE, state: 'PENDING', membershipId: null } })],
  ['a CANCELLING record', worldOf({ record: { ...ACTIVE, state: 'CANCELLING' } })],
  ['a PHONE_CHANGING record', worldOf({ record: { ...ACTIVE, state: 'PHONE_CHANGING' } })],
  ['an already STOPPED record', worldOf({ record: { ...ACTIVE, state: 'STOPPED', membershipId: null } })],
  ['an ACTIVE record with no membership', worldOf({ record: { ...ACTIVE, membershipId: null } })],
])('F3-2 refuses %s before any write or call outside the transaction', async (_name, world) => {
  await expect(run(world)).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(world.stopped).toHaveLength(0);
  expect(world.sessionsEnded).toHaveLength(0);
  expect(world.invalidated).toHaveLength(0);
});

it('F3-2 refuses the employee stopping her own access', async () => {
  const world = worldOf();
  await expect(run(world, STAFF_USER)).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(world.stopped).toHaveLength(0);
});

it('F3-2 answers not found for a missing employee or a deleted company before reading authority', async () => {
  const missing = worldOf({ employee: null });
  await expect(run(missing)).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
  expect(missing.order).not.toContain('authority');
  const gone = worldOf({ companyExists: false });
  await expect(run(gone)).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
  expect(gone.order).toEqual(['begin']);
  await expect(run(worldOf({ employee: null }))).rejects.toBeInstanceOf(StaffAccessError);
});

it('F3-2 keeps a committed stop when the session cleanup or the cache invalidation fails', async () => {
  const { result, world } = await run(worldOf({ sessionsFail: true, cacheFails: true }));
  expect(result).toEqual({ role: 'staff', branchId: BRANCH });
  expect(world.stopped).toHaveLength(1);
  expect(world.sessionsEnded).toHaveLength(1);
  expect(world.invalidated).toHaveLength(1);
});
