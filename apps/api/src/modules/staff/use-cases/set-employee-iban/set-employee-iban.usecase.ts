import type { SetEmployeeIbanInput } from '@pospay/contracts';
import type { GccBank } from '@pospay/domain';
import {
  EmployeeIbanError,
  managedIbanView,
  nextIbanEntry,
  validateIbanEntry,
} from '../../domain/employee-iban.ts';
import type {
  EmployeeIbanContext,
  EmployeeIbanIds,
  EmployeeIbanTransactions,
} from '../../ports/employee-iban-transactions.port.ts';
export { EmployeeIbanError } from '../../domain/employee-iban.ts';

/** يضبط الحساب أو يمسحه مع منع التكرار وحفظ تاريخ وتدقيق كل تغيير فعلي. */
export class SetEmployeeIbanUseCase {
  constructor(
    private readonly transactions: EmployeeIbanTransactions,
    private readonly ids: EmployeeIbanIds,
    private readonly banks: readonly GccBank[],
  ) {}

  execute(context: EmployeeIbanContext & { input: SetEmployeeIbanInput }) {
    return this.transactions.run(context, async (tx) => {
      const terms = validateIbanEntry(context.input, this.banks);
      const before = await tx.loadCurrent();
      const after = nextIbanEntry(
        before,
        terms,
        this.ids.newId(),
        context.employeeId,
        context.userId,
        context.input.expected_revision,
      );
      if (after === null) return managedIbanView(before);
      if (after.iban !== null && (await tx.ibanUsedByOtherEmployee(after.iban)))
        throw new EmployeeIbanError('EMPLOYEE_IBAN_ALREADY_USED');
      return managedIbanView(await tx.save(before, after));
    });
  }
}
