import {
  appendAuditLogs,
  serviceCategoryCascadeStatement,
  type IdGenerator,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ServiceCategoryError } from '../domain/errors.ts';
import type { ServiceRecordChange } from '../domain/service-category-closing.ts';
import { serviceCategorySnapshot, type ServiceCategoryRecord } from '../domain/service-category.ts';
import type { ServiceRecord } from '../domain/service.ts';
import type { ServiceCategoryClosingAudit } from '../ports/service-category-transactions.port.ts';

/**
 * يحفظ حالة التصنيف على نسخته المقفولة، ثم يغلق خدماته المفتوحة أو يفتح اللي هو أغلقها بجملة
 * واحدة تكتب تحديثها وصفوف تدقيقها مع بعض. المجموعة اللي بتتغير هي اللي خطّط لها النطاق تحت
 * القفل؛ لو اختلف عددها عن الخطة، المعاملة تتراجع والمدير يجرب من جديد.
 */
export async function saveClosing(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  category: ServiceRecordChange<ServiceCategoryRecord>,
  services: readonly ServiceRecordChange<ServiceRecord>[],
): Promise<void> {
  const categoryRows = await tx.execute(sql`UPDATE service_categories
    SET closed_at=${category.after.closed_at},updated_at=${category.after.updated_at},
      revision=${category.after.revision}
    WHERE company_id=${companyId} AND business_id=${category.before.business_id}
      AND id=${category.before.id} AND revision=${category.before.revision} RETURNING id`);
  if (categoryRows.length === 0)
    throw new ServiceCategoryError('SERVICE_CATEGORY_REVISION_CONFLICT');
  if (services.length === 0) return;
  const closing = category.before.closed_at === null;
  const audited = await tx.execute(
    serviceCategoryCascadeStatement({
      companyId,
      businessId: category.before.business_id,
      categoryId: category.before.id,
      closing,
      at: category.after.updated_at,
      auditIds: JSON.stringify(
        services.map((service) => ({ service_id: service.before.id, audit_id: ids.newId() })),
      ),
      expectedCount: services.length,
    }),
  );
  if (audited.length !== services.length)
    throw new ServiceCategoryError('TRANSACTION_RETRY_REQUIRED');
}

/**
 * تدقيق التصنيف نفسه: صف واحد العملية. تدقيق الخدمات كاتبه جملة الكاسكاد مع تحديثها، عشان
 * الأثر كله يبقى ذري في أمر واحد.
 */
export async function auditClosing(
  tx: Tx,
  ids: IdGenerator,
  closing: ServiceCategoryClosingAudit,
): Promise<void> {
  await appendAuditLogs(tx, [
    {
      id: ids.newId(),
      entry: {
        entity: 'service_category',
        entityId: closing.category.after.id,
        action: closing.action,
        before: serviceCategorySnapshot(closing.category.before),
        after: serviceCategorySnapshot(closing.category.after),
      },
    },
  ]);
}
