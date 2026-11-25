import { expect, it } from 'vitest';

import type { StaffAccessRecordRow } from '../../domain/staff-access.ts';
import type {
  ChangeEmployeeStaffPhoneCommand,
  ChangeEmployeeStaffPhoneScope,
  ChangeEmployeeStaffPhoneSteps,
  StaffAccessEmployeeRow,
  StaffAccessPhoneChangeRequest,
  StaffAccessPhoneUserSteps,
} from '../../ports/staff-access.port.ts';
import { StaffAccessError } from '../../domain/errors.ts';
import { ChangeEmployeeStaffPhoneUseCase } from './change-employee-staff-phone.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000c1';
const BUSINESS = '01920000-0000-7000-8000-0000000000b1';
const BRANCH = '01920000-0000-7000-8000-0000000000b2';
const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
const STAFF_USER = '01920000-0000-7000-8000-0000000000a1';
const ACTOR = '01920000-0000-7000-8000-0000000000d1';
const NEW_ATTEMPT = '01920000-0000-7000-8000-0000000000ff';
const PHONE = '+96551234999';

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

/** العالم المزيف: السجل المتغيّر بين الخطوتين وما اتكتب بالترتيب. */
interface World {
  employee: StaffAccessEmployeeRow | null;
  record: StaffAccessRecordRow | null;
  authority: boolean;
  companyExists: boolean;
  order: string[];
  started: { recordId: string; userId: string; phoneHash: string; resumeAttempt: string | null }[];
  completed: { recordId: string; userId: string; pinHash: string }[];
  events: { employeeId: string; userId: string; branchId: string }[];
  changes: StaffAccessPhoneChangeRequest[];
  invalidated: { companyId: string; membershipId: string }[];
  /** يشتغل بعد خطوة auth ليمثّل طلباً أحدث غيّر السجل بين الخطوتين. */
  betweenSteps?: (world: World) => void;
  cacheFails: boolean;
  phoneTaken: boolean;
}

const worldOf = (overrides: Partial<World> = {}): World => ({
  employee: EMPLOYEE_ROW,
  record: ACTIVE,
  authority: true,
  companyExists: true,
  order: [],
  started: [],
  completed: [],
  events: [],
  changes: [],
  invalidated: [],
  cacheFails: false,
  phoneTaken: false,
  ...overrides,
});

function scopeOf(world: World): ChangeEmployeeStaffPhoneScope {
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
    phoneHash: (phone) => `hash:${phone}`,
    startChange: async (input) => {
      world.order.push('start');
      world.started.push(input);
      const attemptId = input.resumeAttempt ?? NEW_ATTEMPT;
      if (world.record !== null)
        world.record = { ...world.record, state: 'PHONE_CHANGING', phoneHash: input.phoneHash, attemptId };
      return attemptId;
    },
    completeChange: async (input) => {
      world.order.push('complete');
      world.completed.push(input);
      if (world.record !== null) world.record = { ...world.record, state: 'ACTIVE' };
    },
    appendEvent: async (payload) => {
      world.order.push('event');
      world.events.push(payload);
    },
  };
}

async function run(world: World, command: Partial<ChangeEmployeeStaffPhoneCommand> = {}) {
  const steps: ChangeEmployeeStaffPhoneSteps = { run: async (_a, _i, work) => work(scopeOf(world)) };
  const users: StaffAccessPhoneUserSteps = {
    changePhone: async (input) => {
      world.order.push('auth');
      world.changes.push(input);
      if (world.phoneTaken) throw new StaffAccessError('STAFF_ACCESS_PHONE_TAKEN');
      world.betweenSteps?.(world);
    },
    hash: async (pin) => {
      world.order.push('hash');
      return `hash:${pin}`;
    },
  };
  const useCase = new ChangeEmployeeStaffPhoneUseCase(
    steps,
    users,
    {
      invalidate: async (input) => {
        world.invalidated.push(input);
        if (world.cacheFails) throw new Error('REDIS_DOWN');
      },
    },
    { now: () => new Date('2026-11-25T00:00:00.000Z') },
    { newId: () => NEW_ATTEMPT },
  );
  const result = await useCase.execute({
    companyId: COMPANY,
    userId: ACTOR,
    businessId: BUSINESS,
    employeeId: EMPLOYEE,
    phone: PHONE,
    pin: '4321',
    ...command,
  });
  return { result, world };
}

it('F3-1 runs the three steps in order and answers from the locked record', async () => {
  const { result, world } = await run(worldOf());
  expect(result).toEqual({ kind: 'changed', role: 'staff', branchId: BRANCH, phoneLast3: '999' });
  expect(world.order).toEqual([
    'lock',
    'authority',
    'start',
    'lock',
    'authority',
    'auth',
    'hash',
    'lock',
    'authority',
    'complete',
    'event',
  ]);
  expect(world.started).toEqual([
    { recordId: ACTIVE.id, userId: STAFF_USER, phoneHash: `hash:${PHONE}`, resumeAttempt: null },
  ]);
  expect(world.changes).toEqual([
    expect.objectContaining({
      operationId: ACTIVE.operationId,
      companyId: COMPANY,
      userId: STAFF_USER,
      phone: PHONE,
      actorUserId: ACTOR,
      attemptId: NEW_ATTEMPT,
    }),
  ]);
  expect(world.completed).toEqual([{ recordId: ACTIVE.id, userId: STAFF_USER, pinHash: 'hash:4321' }]);
  expect(world.events).toEqual([{ employeeId: EMPLOYEE, userId: STAFF_USER, branchId: BRANCH }]);
  expect(world.invalidated).toEqual([{ companyId: COMPANY, membershipId: ACTIVE.membershipId }]);
});

it.each([
  ['the employee herself', worldOf({ employee: { ...EMPLOYEE_ROW, userId: ACTOR } })],
  ['a user who is not staff', worldOf({ record: null })],
  ['an unlinked employee', worldOf({ employee: { ...EMPLOYEE_ROW, userId: null } })],
  ['a STOPPED record', worldOf({ record: { ...ACTIVE, state: 'STOPPED' } })],
  ['a PENDING record', worldOf({ record: { ...ACTIVE, state: 'PENDING' } })],
  ['a CANCELLING record', worldOf({ record: { ...ACTIVE, state: 'CANCELLING' } })],
  ['a caller without authority', worldOf({ authority: false })],
])('F3-1 refuses %s before any write', async (_name, world) => {
  await expect(run(world)).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(world.started).toHaveLength(0);
  expect(world.changes).toHaveLength(0);
  expect(world.completed).toHaveLength(0);
});

it('F3-1 refuses an employee of another company before anything is read', async () => {
  const world = worldOf({ companyExists: false });
  await expect(run(world)).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
  expect(world.order).toEqual([]);
});

it('F3-1 resumes an interrupted change for the same phone on the same attempt', async () => {
  const interrupted = { ...ACTIVE, state: 'PHONE_CHANGING' as const, phoneHash: `hash:${PHONE}` };
  const { world } = await run(worldOf({ record: interrupted }));
  expect(world.started[0]?.resumeAttempt).toBe(ACTIVE.attemptId);
  expect(world.changes[0]?.attemptId).toBe(ACTIVE.attemptId);
  expect(world.completed).toHaveLength(1);
});

it('F3-1 starts a new attempt when an interrupted change is repeated with another phone', async () => {
  const interrupted = { ...ACTIVE, state: 'PHONE_CHANGING' as const, phoneHash: 'hash:+96551230000' };
  const { world } = await run(worldOf({ record: interrupted }));
  expect(world.started[0]?.resumeAttempt).toBeNull();
  expect(world.changes[0]?.attemptId).toBe(NEW_ATTEMPT);
});

it('F3-1 a refused phone stops the sequence before the PIN is saved', async () => {
  const world = worldOf({ phoneTaken: true });
  await expect(run(world)).rejects.toMatchObject({ code: 'STAFF_ACCESS_PHONE_TAKEN' });
  expect(world.completed).toHaveLength(0);
  expect(world.events).toHaveLength(0);
});

it('F3-1 refuses the fenced auth step before touching auth when a newer attempt took over after step one', async () => {
  let lockCalls = 0;
  const world = worldOf();
  const base = scopeOf(world);
  const steps: ChangeEmployeeStaffPhoneSteps = {
    run: async (_a, _i, work) =>
      work({
        ...base,
        lock: async () => {
          lockCalls += 1;
          if (lockCalls === 2 && world.record !== null) {
            world.record = { ...world.record, attemptId: '01920000-0000-7000-8000-0000000000ee' };
          }
          return base.lock();
        },
      }),
  };
  const users: StaffAccessPhoneUserSteps = {
    changePhone: async (input) => {
      world.changes.push(input);
    },
    hash: async (pin) => `hash:${pin}`,
  };
  const useCase = new ChangeEmployeeStaffPhoneUseCase(
    steps,
    users,
    { invalidate: async () => undefined },
    { now: () => new Date('2026-11-25T00:00:00.000Z') },
    { newId: () => NEW_ATTEMPT },
  );
  await expect(
    useCase.execute({
      companyId: COMPANY,
      userId: ACTOR,
      businessId: BUSINESS,
      employeeId: EMPLOYEE,
      phone: PHONE,
      pin: '4321',
    }),
  ).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(world.changes).toHaveLength(0);
  expect(world.completed).toHaveLength(0);
});

it('F3-1 refuses to commit when a newer attempt took over the record between the steps', async () => {
  const world = worldOf({
    betweenSteps: (w) => {
      if (w.record !== null) w.record = { ...w.record, attemptId: '01920000-0000-7000-8000-0000000000ee' };
    },
  });
  await expect(run(world)).rejects.toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(world.completed).toHaveLength(0);
  expect(world.events).toHaveLength(0);
});

it('F3-1 writes nothing twice when an identical request already finished the change', async () => {
  const world = worldOf({
    betweenSteps: (w) => {
      if (w.record !== null) w.record = { ...w.record, state: 'ACTIVE' };
    },
  });
  const { result } = await run(world);
  expect(result.kind).toBe('already');
  expect(world.completed).toHaveLength(0);
  expect(world.events).toHaveLength(0);
  expect(world.invalidated).toHaveLength(0);
});

it('F3-1 a failed cache invalidation after the commit does not turn the change into an error', async () => {
  const { result, world } = await run(worldOf({ cacheFails: true }));
  expect(result.kind).toBe('changed');
  expect(world.invalidated).toHaveLength(1);
});
