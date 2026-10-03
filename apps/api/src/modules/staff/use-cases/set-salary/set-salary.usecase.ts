import type { SetSalaryInput } from '@pospay/contracts';
import { nextSalary, validateSalary, salarySnapshot } from '../../domain/set-salary.ts';
import type { SalaryTransactions, SalaryIds } from '../../ports/salary-transactions.port.ts';
export { SalaryError } from '../../domain/set-salary.ts';

// يضع الراتب الأساسي ويترك التزامن والتدقيق والحدث للمعاملة الواحدة.
export class SetSalaryUseCase {
  constructor(
    private readonly transactions: SalaryTransactions,
    private readonly ids: SalaryIds,
  ) {}
  async execute(context: {
    companyId: string;
    userId: string;
    businessId: string;
    employeeId: string;
    key: string;
    fingerprint: string;
    input: SetSalaryInput;
  }) {
    const saved = await this.transactions.run(context, async (tx) => {
      const terms = validateSalary(context.input);
      const before = await tx.load(context.employeeId, terms.effective_from);
      const after = nextSalary(before, terms, this.ids.newId(), context.employeeId, context.userId);
      await tx.save(context.businessId, before, after);
      return after;
    });
    return salarySnapshot(saved);
  }
}
