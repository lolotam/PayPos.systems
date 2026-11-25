import type { TenantWrappers } from '@pospay/db';
import { readPackageImportTemplateServices } from '../../catalog/index.ts';
import { readPackageImportAccess } from '../../identity/index.ts';
import { PackageImportRequestError } from '../domain/package-import-request.ts';
import { PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES } from '../domain/package-import-template.ts';
import type { PackageImportTemplateTransactions } from '../ports/package-import-template.port.ts';

/**
 * يبني معاملة قراءة القالب: إذن حي وميزة orders على معاملة الشركة نفسها، ثم الخدمات المفتوحة بسقف يزيد
 * واحداً على سعة القالب؛ قراءة فقط لا تكتب أي صف.
 *
 * @param database بوابة المستأجر
 * @returns معاملة قراءة الحقائق
 */
export function createPackageImportTemplateTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
): PackageImportTemplateTransactions {
  return {
    runFacts: (actor, work) =>
      database.withTenant(
        actor.companyId,
        async (tx) => {
          const refusal = await readPackageImportAccess(tx, actor);
          if (refusal !== null) throw new PackageImportRequestError(refusal);
          return work({
            services: (businessId) =>
              readPackageImportTemplateServices(
                tx,
                actor.companyId,
                businessId,
                PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES + 1,
              ),
          });
        },
        { userId: actor.userId },
      ),
  };
}
