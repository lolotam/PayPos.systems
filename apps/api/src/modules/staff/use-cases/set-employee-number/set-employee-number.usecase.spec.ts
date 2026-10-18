import { expect, it } from 'vitest';
import { SetEmployeeNumberError } from '../../domain/employee-number-change.ts';
import type { EmployeeNumberLock, EmployeeNumberRow, SetEmployeeNumberScope } from '../../ports/employee-number.port.ts';
import { SetEmployeeNumberUseCase } from './set-employee-number.usecase.ts';

const command = {
  companyId: 'company',
  userId: 'user',
  businessId: 'business',
  employeeId: 'employee',
  employeeNumber: 8,
};

function row(employeeNumber = 1, attached: readonly string[] = ['primary', 'other']): EmployeeNumberRow {
  return {
    business_id: 'business',
    primary_branch_id: 'primary',
    employee_number: employeeNumber,
    attached_branch_ids: attached,
  };
}

function harness(options: {
  row?: EmployeeNumberRow | null;
  locked?: EmployeeNumberLock | null;
  refusal?: 'FORBIDDEN' | 'FEATURE_DISABLED' | null;
  refuseBranches?: readonly string[];
  held?: boolean;
} = {}) {
  const steps: string[] = [];
  const seen: { businessId?: string; branchIds?: readonly string[] } = {};
  const mark = (name: string) => {
    steps.push(name);
  };
  const recheck = async (businessId: string, branchIds: readonly string[]) => {
    mark('recheck');
    seen.businessId = businessId;
    seen.branchIds = branchIds;
    if (options.refuseBranches?.some((branchId) => branchIds.includes(branchId))) return 'FORBIDDEN';
    return options.refusal ?? null;
  };
  const scope: SetEmployeeNumberScope = {
    lockAccess: async () => mark('lockAccess'),
    readEmployee: async () => {
      mark('readEmployee');
      return options.row === undefined ? row() : options.row;
    },
    recheck,
    lockCounter: async () => mark('lockCounter'),
    lockEmployee: async () => {
      mark('lockEmployee');
      if (options.locked !== undefined) return options.locked;
      const source = options.row === undefined ? row() : options.row;
      return {
        employee_number: source?.employee_number ?? 1,
        primary_branch_id: source?.primary_branch_id ?? 'primary',
        attached_branch_ids: source?.attached_branch_ids ?? [],
      };
    },
    taken: async () => {
      mark('taken');
      return options.held ?? false;
    },
    save: async () => mark('save'),
  };
  return { steps, seen, useCase: new SetEmployeeNumberUseCase({ run: (_actor, work) => work(scope) }) };
}

it('locks the counter only after a real change, then the employee, the taken check and the save', async () => {
  const { steps, seen, useCase } = harness();
  await expect(useCase.execute(command)).resolves.toEqual({ employee_id: 'employee', employee_number: 8 });
  expect(steps).toEqual(['lockAccess', 'readEmployee', 'recheck', 'lockCounter', 'lockEmployee', 'taken', 'save']);
  expect(seen).toEqual({ businessId: 'business', branchIds: ['primary', 'other'] });
});

it('does not lock the counter when the first read is already the requested number', async () => {
  const { steps, useCase } = harness({ row: row(8) });
  await expect(useCase.execute(command)).resolves.toEqual({ employee_id: 'employee', employee_number: 8 });
  expect(steps).toEqual(['lockAccess', 'readEmployee', 'recheck']);
});

it('stops before the recheck when the row is missing or belongs to another business', async () => {
  const missing = harness({ row: null });
  await expect(missing.useCase.execute(command)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(missing.steps).toEqual(['lockAccess', 'readEmployee']);
  const elsewhere = harness({ row: { ...row(), business_id: 'elsewhere' } });
  await expect(elsewhere.useCase.execute(command)).rejects.toBeInstanceOf(SetEmployeeNumberError);
  expect(elsewhere.steps).toEqual(['lockAccess', 'readEmployee']);
});

it('does not lock the counter when the recheck refuses', async () => {
  const { steps, useCase } = harness({ refusal: 'FORBIDDEN' });
  await expect(useCase.execute(command)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(steps).toEqual(['lockAccess', 'readEmployee', 'recheck']);
});

it('locks the counter before reporting that the number is taken, and does not save', async () => {
  const { steps, useCase } = harness({ held: true });
  await expect(useCase.execute(command)).rejects.toMatchObject({ code: 'EMPLOYEE_NUMBER_TAKEN' });
  expect(steps).toEqual(['lockAccess', 'readEmployee', 'recheck', 'lockCounter', 'lockEmployee', 'taken']);
});

it('does not save when the locked row already has the requested number', async () => {
  const { steps, useCase } = harness({
    locked: { employee_number: 8, primary_branch_id: 'primary', attached_branch_ids: ['primary', 'other'] },
  });
  await expect(useCase.execute(command)).resolves.toEqual({ employee_id: 'employee', employee_number: 8 });
  expect(steps).toEqual(['lockAccess', 'readEmployee', 'recheck', 'lockCounter', 'lockEmployee']);
});

it('checks the primary branch even when it is absent from the current attachments', async () => {
  const { seen, useCase } = harness({ row: row(1, ['other']) });
  await expect(useCase.execute(command)).resolves.toEqual({ employee_id: 'employee', employee_number: 8 });
  expect(seen.branchIds).toEqual(['primary', 'other']);
});

it('does not lock the counter when the staff feature is off', async () => {
  const { steps, useCase } = harness({ refusal: 'FEATURE_DISABLED' });
  await expect(useCase.execute(command)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  expect(steps).toEqual(['lockAccess', 'readEmployee', 'recheck']);
});

it('rechecks branches read under the employee lock when they differ and writes nothing if that recheck denies', async () => {
  const { steps, seen, useCase } = harness({
    row: row(1, ['other']),
    locked: { employee_number: 1, primary_branch_id: 'primary', attached_branch_ids: ['late'] },
    refuseBranches: ['late'],
  });
  await expect(useCase.execute(command)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(steps).toEqual(['lockAccess', 'readEmployee', 'recheck', 'lockCounter', 'lockEmployee', 'recheck']);
  expect(seen.branchIds).toEqual(['primary', 'late']);
});
