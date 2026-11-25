import { expect, it } from 'vitest';

import type { StaffAccessRecordRow } from '../../domain/staff-access.ts';
import type {
  ResetEmployeeStaffPinCommand,
  ResetEmployeeStaffPinScope,
  ResetEmployeeStaffPinSteps,
  StaffAccessEmployeeRow,
  StaffAccessUserSteps,
} from '../../ports/staff-access.port.ts';
import { ResetEmployeeStaffPinUseCase } from './reset-employee-staff-pin.ts';

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

const ACTIVE_RECORD: StaffAccessRecordRow = {
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

/** حالة العالم المزيف: الموظفة والسجل والسلطة وما اتكتب. */
interface World {
  employee: StaffAccessEmployeeRow | null;
  record: StaffAccessRecordRow | null;
  authority: boolean;
  companyExists: boolean;
  saved: { userId: string; pinHash: string }[];
  events: { employeeId: string; userId: string; branchId: string }[];
  order: string[];
}

function worldOf(overrides: Partial<World> = {}): World {
  return {
    employee: EMPLOYEE_ROW,
    record: ACTIVE_RECORD,
    authority: true,
    companyExists: true,
    saved: [],
    events: [],
    order: [],
    ...overrides,
  };
}

/** يشغّل الـ use case على عالم مزيف ويرجّع النتيجة والعالم. */
async function run(world: World, command: Partial<ResetEmployeeStaffPinCommand> = {}) {
  const scope: ResetEmployeeStaffPinScope = {
    lockCompany: async () => world.companyExists,
    lock: async () => {
      world.order.push('lock');
      return { employee: world.employee, record: world.record };
    },
    authority: async () => {
      world.order.push('authority');
      return world.authority;
    },
    saveTemporaryPin: async (userId, pinHash) => {
      world.order.push('save');
      world.saved.push({ userId, pinHash });
    },
    appendEvent: async (payload) => {
      world.order.push('event');
      world.events.push(payload);
    },
  };
  const steps: ResetEmployeeStaffPinSteps = {
    run: async (_actor, _input, work) => work(scope),
  };
  const users: StaffAccessUserSteps = {
    provision: async () => ({ userId: STAFF_USER }),
    accountExists: async () => true,
    hash: async (pin) => {
      world.order.push('hash');
      return `hash:${pin}`;
    },
  };
  const useCase = new ResetEmployeeStaffPinUseCase(
    steps,
    users,
    { now: () => new Date('2026-11-25T00:00:00.000Z') },
    { newId: () => '01920000-0000-7000-8000-0000000000ff' },
  );
  const result = await useCase.execute({
    companyId: COMPANY,
    userId: ACTOR,
    businessId: BUSINESS,
    employeeId: EMPLOYEE,
    pin: '4321',
    ...command,
  });
  return { result, world };
}

it('F2b-1 the reset writes the temporary PIN and the event, and reads the state from the locked record', async () => {
  const { result, world } = await run(worldOf());
  expect(result).toEqual({ role: 'staff', branchId: BRANCH, userId: STAFF_USER });
  expect(world.saved).toEqual([{ userId: STAFF_USER, pinHash: 'hash:4321' }]);
  expect(world.events).toEqual([
    { employeeId: EMPLOYEE, userId: STAFF_USER, branchId: BRANCH },
  ]);
  // التصوير بيحصل قبل ما المعاملة تفتح — الـ hashing بطيء مقصود.
  expect(world.order).toEqual(['hash', 'lock', 'authority', 'save', 'event']);
});

it('F2b-3 the reset refuses the employee herself and writes nothing', async () => {
  const world = worldOf({ employee: { ...EMPLOYEE_ROW, userId: ACTOR } });
  await expect(run(world)).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(world.saved).toHaveLength(0);
  expect(world.events).toHaveLength(0);
});

it('F2b-4 the reset refuses a user who is not staff and writes nothing', async () => {
  const world = worldOf({ record: null });
  await expect(run(world)).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(world.saved).toHaveLength(0);
  expect(world.events).toHaveLength(0);
});

it('F2b-5 the reset refuses a record that is not ACTIVE and writes nothing', async () => {
  const world = worldOf({ record: { ...ACTIVE_RECORD, state: 'PENDING' } });
  await expect(run(world)).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(world.saved).toHaveLength(0);
  expect(world.events).toHaveLength(0);
});

it('F2b-2 the reset refuses without authority on the employee branch and writes nothing', async () => {
  const world = worldOf({ authority: false });
  await expect(run(world)).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(world.saved).toHaveLength(0);
  expect(world.events).toHaveLength(0);
});

it('F2b-2 the reset refuses an employee of another company before anything is read', async () => {
  const world = worldOf({ companyExists: false });
  await expect(run(world)).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
  expect(world.order).toEqual(['hash']);
  expect(world.saved).toHaveLength(0);
});
