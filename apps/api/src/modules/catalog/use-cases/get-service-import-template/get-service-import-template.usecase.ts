import type { ServiceImportTemplate } from '@pospay/contracts';

import { ServiceImportError } from '../../domain/errors.ts';
import {
  SERVICE_IMPORT_CONTENT_TYPE,
  SERVICE_IMPORT_TEMPLATE_FILE_NAME,
  serviceImportTemplateCapacity,
} from '../../domain/service-import-template.ts';
import type {
  ServiceImportCategoryOption,
  ServiceImportTemplateBuilder,
  ServiceImportTransactions,
} from '../../ports/service-import.port.ts';

export interface GetServiceImportTemplateCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
}

/**
 * يبني قالب استيراد الخدمات لتصنيفات النشاط المتحقق منها: فحص السعة المرجعية قبل البناء
 * يرفض التنزيل برفض مسمّى قبل أي عمل، والبناء نفسه يمرّر الناتج على القارئ المحمي (P-3)،
 * والعملية قراءة فقط لا تكتب أي صف.
 */
export class GetServiceImportTemplateUseCase {
  constructor(
    private readonly transactions: ServiceImportTransactions,
    private readonly builder: ServiceImportTemplateBuilder,
  ) {}

  async execute(command: GetServiceImportTemplateCommand): Promise<ServiceImportTemplate> {
    const categories = await this.transactions.runFacts(command, async (scope) => {
      const options: readonly ServiceImportCategoryOption[] = await scope.categories(
        command.businessId,
      );
      const capacity = serviceImportTemplateCapacity(options.length);
      if (!capacity.ok) throw new ServiceImportError('IMPORT_TEMPLATE_EXCEEDS_LIMITS');
      return options;
    });
    return {
      file_name: SERVICE_IMPORT_TEMPLATE_FILE_NAME,
      content_type: SERVICE_IMPORT_CONTENT_TYPE,
      content_base64: await this.builder.build(categories),
    };
  }
}
