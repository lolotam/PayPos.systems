import type { PackageImportTemplate } from '@pospay/contracts';
import type { PackageImportActor } from '../../domain/package-import-request.ts';
import {
  PACKAGE_IMPORT_CONTENT_TYPE,
  PACKAGE_IMPORT_TEMPLATE_FILE_NAME,
  PackageImportTemplateError,
  packageImportTemplateCapacity,
} from '../../domain/package-import-template.ts';
import type {
  PackageImportTemplateBuilder,
  PackageImportTemplateTransactions,
} from '../../ports/package-import-template.port.ts';

// يبني قالب الاستيراد لخدمات النشاط المفتوحة: فحص السعة قبل البناء يرفض التنزيل برفض مسمّى، والعملية قراءة فقط.
export class GetPackageImportTemplateUseCase {
  constructor(
    private readonly transactions: PackageImportTemplateTransactions,
    private readonly builder: PackageImportTemplateBuilder,
  ) {}

  async execute(command: PackageImportActor): Promise<PackageImportTemplate> {
    const services = await this.transactions.runFacts(command, async (scope) => {
      const open = await scope.services(command.businessId);
      if (!packageImportTemplateCapacity(open.length).ok)
        throw new PackageImportTemplateError('IMPORT_TEMPLATE_EXCEEDS_LIMITS');
      return open;
    });
    return {
      file_name: PACKAGE_IMPORT_TEMPLATE_FILE_NAME,
      content_type: PACKAGE_IMPORT_CONTENT_TYPE,
      content_base64: await this.builder.build(services),
    };
  }
}

export { PackageImportTemplateError } from '../../domain/package-import-template.ts';
