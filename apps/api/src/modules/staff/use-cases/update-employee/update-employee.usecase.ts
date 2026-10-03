import type { EmployeeDetail, UpdateEmployeeInput } from '@pospay/contracts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { EmployeeCreationError, validateEmployeeBranch } from '../../domain/create-employee.ts';
import { planEmployeeUpdate } from '../../domain/update-employee.ts';
import type { EmployeeUpdateTransactions } from '../../ports/employee-update-transactions.port.ts';

export { EmployeeCreationError } from '../../domain/create-employee.ts';
export interface UpdateEmployeeCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly employeeId: string;
  readonly input: UpdateEmployeeInput;
}
// يعدل بيانات الوظيفة وارتباطات الفروع بعد فحص المصدر والهدف تحت الأقفال، دون منح وصول جديد.
export class UpdateEmployeeUseCase {
  constructor(
    private readonly transactions: EmployeeUpdateTransactions,
    private readonly ids: IdGenerator,
  ) {}

  execute(command: UpdateEmployeeCommand): Promise<EmployeeDetail> {
    return this.transactions.run(command, async (scope) => {
      const current = await scope.load(command.businessId, command.employeeId);
      if (current === null) throw new EmployeeCreationError('NOT_FOUND');
      const requested = [
        ...new Set([...command.input.branch_ids, command.input.primary_branch_id]),
      ];
      const contexts = await scope.contexts(current.record, requested);
      // تبعية الفروع قبل تشخيص الهدف؛ المفقود والخارج عن النشاط لهما نفس الرد، والمنع يسبق كشف التاريخ.
      for (const context of contexts) validateEmployeeBranch(current.record.business_id, context);
      if (!(await scope.authorize(current.record.business_id, requested)))
        throw new EmployeeCreationError('FORBIDDEN');
      const plan = planEmployeeUpdate(current.record, command.input, current.history, contexts);
      if (plan.after.user_id !== null && !(await scope.canLinkUser(plan.after.user_id)))
        throw new EmployeeCreationError('EMPLOYEE_USER_LINK_UNAVAILABLE');
      if (plan.changed)
        await scope.save(
          current.record,
          plan,
          command.input.branch_effective_date,
          plan.attach.map((branchId) => ({ branchId, id: this.ids.newId() })),
        );
      return { ...plan.after, branch_ids: [...plan.after.branch_ids] };
    });
  }
}
