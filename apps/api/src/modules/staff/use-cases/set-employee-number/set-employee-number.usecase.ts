import { employeeNumberChange, SetEmployeeNumberError } from '../../domain/employee-number-change.ts';
import type {
  EmployeeNumberRow,
  SetEmployeeNumberActor,
  SetEmployeeNumberScope,
  SetEmployeeNumberTransactions,
} from '../../ports/employee-number.port.ts';

export { SetEmployeeNumberError } from '../../domain/employee-number-change.ts';

export interface SetEmployeeNumberCommand extends SetEmployeeNumberActor {
  businessId: string;
  employeeId: string;
  employeeNumber: number;
}

/** يغيّر الرقم الوظيفي يدوياً بعد إعادة فحص المنع، ولا يحرّك عدّاد الإسناد ولا يسجل تدقيقاً إن بقي الرقم كما هو. */
export class SetEmployeeNumberUseCase {
  constructor(private readonly transactions: SetEmployeeNumberTransactions) {}

  execute(command: SetEmployeeNumberCommand) {
    return this.transactions.run(command, (scope) => change(command, scope));
  }
}

async function change(command: SetEmployeeNumberCommand, scope: SetEmployeeNumberScope) {
  await scope.lockAccess();
  const row = await scope.readEmployee(command.businessId, command.employeeId);
  if (row === null || row.business_id !== command.businessId) throw new SetEmployeeNumberError('NOT_FOUND');
  const refusal = await scope.recheck(row.business_id, branchTargets(row));
  if (refusal !== null) throw new SetEmployeeNumberError(refusal);
  if (employeeNumberChange(row.employee_number, command.employeeNumber) === null) return view(command);
  await scope.lockCounter();
  const locked = await scope.lockEmployee(command.businessId, command.employeeId);
  if (locked === null) throw new SetEmployeeNumberError('NOT_FOUND');
  const next = employeeNumberChange(locked.employee_number, command.employeeNumber);
  if (next === null) return view(command);
  if (await scope.taken(command.employeeId, command.employeeNumber))
    throw new SetEmployeeNumberError('EMPLOYEE_NUMBER_TAKEN');
  await scope.save(command.employeeId, next);
  return view(command);
}

function view(command: SetEmployeeNumberCommand) {
  return { employee_id: command.employeeId, employee_number: command.employeeNumber };
}

function branchTargets(row: EmployeeNumberRow): string[] {
  const branches = [row.primary_branch_id];
  for (const branchId of row.attached_branch_ids) if (!branches.includes(branchId)) branches.push(branchId);
  return branches;
}
