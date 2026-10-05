import type { EmployeeImportTemplate } from '@pospay/contracts';

import { EMPLOYEE_IMPORT_CONTENT_TYPE, EmployeeImportError } from '../../domain/employee-import.ts';
import type {
  EmployeeImportTransactions,
  ImportTemplateBuilder,
} from '../../ports/employee-import.port.ts';

export interface GetEmployeeImportTemplateCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
}

// يبني قالب استيراد الموظفين لفروع النشاط المتحقق منه، بلا كتابة أي صف.
export class GetEmployeeImportTemplateUseCase {
  constructor(
    private readonly transactions: EmployeeImportTransactions,
    private readonly builder: ImportTemplateBuilder,
  ) {}

  async execute(command: GetEmployeeImportTemplateCommand): Promise<EmployeeImportTemplate> {
    const branches = await this.transactions.runPreview(command, async (scope) => {
      if (!(await scope.authorize(command.businessId))) throw new EmployeeImportError('FORBIDDEN');
      return scope.branches(command.businessId);
    });
    return {
      file_name: 'employees-import-template.xlsx',
      content_type: EMPLOYEE_IMPORT_CONTENT_TYPE,
      content_base64: await this.builder.build(branches),
    };
  }
}
