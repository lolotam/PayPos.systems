import { employeeNumberCounterAfterStart } from '@pospay/domain';
import { SetEmployeeNumberStartError } from '../../domain/errors.ts';
import type {
  EmployeeNumberStartActor,
  EmployeeNumberStartClock,
  EmployeeNumberStartScope,
  EmployeeNumberStartTransactions,
} from '../../ports/employee-number-start.port.ts';

export { SetEmployeeNumberStartError } from '../../domain/errors.ts';

export interface SetEmployeeNumberStartCommand extends EmployeeNumberStartActor {
  startNumber: number;
}

/** يضبط رقم بداية الترقيم مرة واحدة ويرفع العدّاد إن كانت البداية أعلى، دون تغيير أرقام الموظفين. */
export class SetEmployeeNumberStartUseCase {
  constructor(
    private readonly transactions: EmployeeNumberStartTransactions,
    private readonly clock: EmployeeNumberStartClock,
  ) {}

  execute(command: SetEmployeeNumberStartCommand) {
    return this.transactions.run(command, (scope) => applyStart(command, scope, this.clock));
  }
}

async function applyStart(
  command: SetEmployeeNumberStartCommand,
  scope: EmployeeNumberStartScope,
  clock: EmployeeNumberStartClock,
) {
  if (!(await scope.lockAccess())) throw new SetEmployeeNumberStartError('FORBIDDEN');
  const refusal = await scope.recheck();
  if (refusal !== null) throw new SetEmployeeNumberStartError(refusal);
  const row = await scope.lockCounter();
  if (row.startNumber !== null) throw new SetEmployeeNumberStartError('EMPLOYEE_NUMBER_START_ALREADY_SET');
  const nextNumber = employeeNumberCounterAfterStart(row.nextNumber, command.startNumber);
  const at = clock.now();
  await scope.save(at, {
    before: { start_number: null, next_number: row.nextNumber },
    after: { start_number: command.startNumber, next_number: nextNumber },
  });
  return {
    next_number: nextNumber,
    start_number: command.startNumber,
    start_set_at: at.toISOString(),
    can_manage: false as const,
  };
}
