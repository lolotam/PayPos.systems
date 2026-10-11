import { expect, it, vi } from 'vitest';
import type { EmployeeHoursScope } from '../../ports/employee-default-shifts.port.ts';
import { SetEmployeeDefaultShiftsUseCase } from './set-employee-default-shifts.usecase.ts';

const at = new Date('2026-10-10T22:00:00Z');
const input = { shifts: [{ day: 0, start: '09:00', end: '17:00' }] };
const command = { companyId: 'company', userId: 'actor', businessId: 'business', employeeId: 'employee', branchId: 'branch', input };
function fixture(from = '2026-01-01', to: string | null = null, timezone = 'Asia/Kuwait') {
  const scope: EmployeeHoursScope = {
    authorize: vi.fn().mockResolvedValue(undefined),
    employee: vi.fn().mockResolvedValue({ links: [{ branch_id: 'branch', from, to }], timezone }),
    current: vi.fn().mockResolvedValue([]), replace: vi.fn().mockResolvedValue(undefined),
  };
  const clock = { now: vi.fn(() => at) };
  const usecase = new SetEmployeeDefaultShiftsUseCase({ run: (_actor, work) => work(scope) }, clock);
  return { scope, clock, usecase };
}
it('uses the injected branch-local date and timestamp, then validates and replaces', async () => {
  const f = fixture('2026-10-11');
  await f.usecase.execute(command);
  expect(f.scope.authorize).toHaveBeenCalledWith('business');
  expect(f.scope.replace).toHaveBeenCalledWith([], [expect.objectContaining(input.shifts[0])], at);
  expect(f.clock.now).toHaveBeenCalledOnce();
});
it.each([
  ['2026-10-12', null, 'Asia/Kuwait'],
  ['2026-01-01', '2026-10-11', 'Asia/Kuwait'],
  ['2026-10-11', null, 'America/New_York'],
] as const)('refuses links outside the branch-local date', async (from, to, timezone) => {
  const f = fixture(from, to, timezone);
  await expect(f.usecase.execute(command)).rejects.toMatchObject({ code: 'EMPLOYEE_BRANCH_NOT_LINKED' });
  expect(f.scope.current).not.toHaveBeenCalled(); expect(f.scope.replace).not.toHaveBeenCalled();
});
it('does not audit an identical normalized week or an already-empty clear', async () => {
  const f = fixture();
  vi.mocked(f.scope.current).mockResolvedValue(input.shifts);
  await f.usecase.execute(command);
  expect(f.scope.replace).not.toHaveBeenCalled();
  vi.mocked(f.scope.current).mockResolvedValue([]);
  await f.usecase.execute({ ...command, input: { shifts: [] } });
  expect(f.scope.replace).not.toHaveBeenCalled();
});
it('refuses authorization and invalid patterns before writing', async () => {
  const f = fixture();
  await expect(f.usecase.execute({ ...command, input: { shifts: [{ day: 0, start: '09:00', end: '03:00' }] } }))
    .rejects.toMatchObject({ code: 'SCHEDULE_SHIFT_INVALID' });
  expect(f.scope.replace).not.toHaveBeenCalled();
  vi.mocked(f.scope.authorize).mockRejectedValue(new Error('FORBIDDEN'));
  vi.mocked(f.scope.employee).mockClear();
  await expect(f.usecase.execute(command)).rejects.toThrow('FORBIDDEN');
  expect(f.scope.employee).not.toHaveBeenCalled();
});
