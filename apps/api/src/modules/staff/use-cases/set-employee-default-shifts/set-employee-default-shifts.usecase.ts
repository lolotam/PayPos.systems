import type { SetEmployeeDefaultShiftsInput } from '@pospay/contracts';
import { EmployeeDefaultShiftsError, linkedOn, sameDefaultShifts, validateDefaultShifts } from '../../domain/employee-default-shifts.ts';
import { scheduleToday } from '../../domain/schedule-calendar.ts';
import type { EmployeeDefaultShiftsTransactions, EmployeeHoursActor, EmployeeHoursClock } from '../../ports/employee-default-shifts.port.ts';
export { EmployeeDefaultShiftsError } from '../../domain/employee-default-shifts.ts';
export { ScheduleError } from '../../domain/schedule-types.ts';

/** يستبدل دوام فرع مرتبط اليوم بعد التحقق، ويسجل التغيير الفعلي فقط. */
export class SetEmployeeDefaultShiftsUseCase {
  constructor(private readonly transactions: EmployeeDefaultShiftsTransactions,
    private readonly clock: EmployeeHoursClock) {}

  execute(command: EmployeeHoursActor & { businessId: string; employeeId: string; branchId: string; input: SetEmployeeDefaultShiftsInput }) {
    return this.transactions.run(command, async (scope) => {
      const { businessId, employeeId, branchId, input } = command;
      await scope.authorize(businessId);
      const employee = await scope.employee(businessId, employeeId, branchId);
      const at = this.clock.now();
      if (!linkedOn(employee.links, branchId, scheduleToday(at, employee.timezone)))
        throw new EmployeeDefaultShiftsError('EMPLOYEE_BRANCH_NOT_LINKED');
      const after = validateDefaultShifts(input.shifts);
      const before = await scope.current(employeeId, branchId);
      if (!sameDefaultShifts(before, after)) await scope.replace(before, after, at);
    });
  }
}
