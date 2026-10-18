import { expect, it } from 'vitest';
import type {
  EmployeeNumberSequenceRow,
  EmployeeNumberStartAudit,
  EmployeeNumberStartScope,
} from '../../ports/employee-number-start.port.ts';
import { SetEmployeeNumberStartUseCase } from './set-employee-number-start.usecase.ts';

const at = new Date('2026-10-18T12:00:00.000Z');
const command = { companyId: 'company', userId: 'user', startNumber: 1000 };

function harness(row: EmployeeNumberSequenceRow, refusal: 'FORBIDDEN' | 'FEATURE_DISABLED' | null = null) {
  const steps: string[] = [];
  let saved: EmployeeNumberStartAudit | undefined;
  let clockCalls = 0;
  const scope: EmployeeNumberStartScope = {
    lockAccess: async () => {
      steps.push('lockAccess');
    },
    recheck: async () => {
      steps.push('recheck');
      return refusal;
    },
    lockCounter: async () => {
      steps.push('lockCounter');
      return row;
    },
    save: async (_at, change) => {
      steps.push('save');
      saved = change;
    },
  };
  const useCase = new SetEmployeeNumberStartUseCase(
    { run: (_actor, work) => work(scope) },
    {
      now: () => {
        clockCalls += 1;
        return at;
      },
    },
  );
  return { steps, saved: () => saved, clockCalls: () => clockCalls, useCase };
}

it('locks access before the counter and stores the raised counter', async () => {
  const run = harness({ nextNumber: 4, startNumber: null });
  await expect(run.useCase.execute(command)).resolves.toEqual({
    next_number: 1000,
    start_number: 1000,
    start_set_at: at.toISOString(),
    can_manage: false,
  });
  expect(run.steps).toEqual(['lockAccess', 'recheck', 'lockCounter', 'save']);
  expect(run.saved()).toEqual({
    before: { start_number: null, next_number: 4 },
    after: { start_number: 1000, next_number: 1000 },
  });
  expect(run.clockCalls()).toBe(1);
});

it('does not lower a counter that is already ahead of the start', async () => {
  const run = harness({ nextNumber: 4, startNumber: null });
  await expect(run.useCase.execute({ ...command, startNumber: 2 })).resolves.toMatchObject({
    next_number: 4,
    start_number: 2,
    can_manage: false,
  });
  expect(run.saved()?.after).toEqual({ start_number: 2, next_number: 4 });
});

it('does not lock the counter when the recheck refuses', async () => {
  const run = harness({ nextNumber: 1, startNumber: null }, 'FORBIDDEN');
  await expect(run.useCase.execute(command)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(run.steps).toEqual(['lockAccess', 'recheck']);
  expect(run.clockCalls()).toBe(0);
});

it('does not save when the start was already stored', async () => {
  const run = harness({ nextNumber: 1000, startNumber: 1000 });
  await expect(run.useCase.execute(command)).rejects.toMatchObject({
    code: 'EMPLOYEE_NUMBER_START_ALREADY_SET',
  });
  expect(run.steps).toEqual(['lockAccess', 'recheck', 'lockCounter']);
  expect(run.saved()).toBeUndefined();
});
