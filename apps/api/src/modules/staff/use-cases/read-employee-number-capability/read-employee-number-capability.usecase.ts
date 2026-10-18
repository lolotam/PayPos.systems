import { EmployeeCreationError } from '../../domain/create-employee.ts';
import type { EmployeeTransactions } from '../../ports/employee-transactions.port.ts';

export { EmployeeCreationError } from '../../domain/create-employee.ts';

export interface ReadEmployeeNumberCapabilityCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly primaryBranchId: string;
}

// يقرأ هل يجوز كتابة الرقم على نشاط وفرع أساسي بعد قفل الإنشاء نفسه، بلا أي كتابة.
export class ReadEmployeeNumberCapabilityUseCase {
  constructor(private readonly transactions: EmployeeTransactions) {}

  execute(command: ReadEmployeeNumberCapabilityCommand): Promise<{ can_type_number: boolean }> {
    return this.transactions.run(command, async (scope) => {
      if (!(await scope.authorize(command.businessId, command.primaryBranchId)))
        throw new EmployeeCreationError('FORBIDDEN');
      const decision = await scope.recheckTypedNumber(command.businessId, command.primaryBranchId);
      if (decision === 'FEATURE_DISABLED') throw new EmployeeCreationError('FEATURE_DISABLED');
      return { can_type_number: decision === null };
    });
  }
}
