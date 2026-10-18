import type { CreateEmployeeInput, CreatedEmployee } from '@pospay/contracts';
import { employeeNameMatchKey } from '@pospay/domain';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import {
  EmployeeCreationError,
  validateEmployeeCreation,
  type EmployeeRecord,
} from '../../domain/create-employee.ts';
import type { EmployeeTransactions } from '../../ports/employee-transactions.port.ts';

export { EmployeeCreationError } from '../../domain/create-employee.ts';
export interface CreateEmployeeCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly input: CreateEmployeeInput;
}
// ينشئ سجل الموظف برقمه التالي والفرع والتدقيق بعد التحقق من الإذن الحي، دون أي أثر مالي.
export class CreateEmployeeUseCase {
  constructor(
    private readonly transactions: EmployeeTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: CreateEmployeeCommand): Promise<CreatedEmployee> {
    return this.transactions.run(command, async (scope) => {
      if (!(await scope.authorize(command.businessId, command.input.primary_branch_id)))
        throw new EmployeeCreationError('FORBIDDEN');
      const at = this.clock.now();
      const record: EmployeeRecord = {
        ...command.input,
        id: this.ids.newId(),
        business_id: command.businessId,
        name_ar: command.input.name_ar ?? null,
        user_id: command.input.user_id ?? null,
        contract_end: command.input.contract_end ?? null,
        created_at: at.toISOString(),
      };
      validateEmployeeCreation(record, await scope.context(record));
      if (record.user_id !== null && !(await scope.canLinkUser(record.user_id)))
        throw new EmployeeCreationError('EMPLOYEE_USER_LINK_UNAVAILABLE');
      const numbered = { ...record, employee_number: await scope.assignEmployeeNumber() };
      // قرار المالك 2026-10-03: الوصول خطوة صريحة في شاشة الصلاحيات؛ إنشاء سجل الوظيفة لا يمنح عضوية.
      await scope.insert(
        {
          ...numbered,
          name_en_key: employeeNameMatchKey(numbered.name_en),
          name_ar_key: numbered.name_ar === null ? null : employeeNameMatchKey(numbered.name_ar),
        },
        this.ids.newId(),
      );
      await scope.audit(numbered);
      return numbered;
    });
  }
}
