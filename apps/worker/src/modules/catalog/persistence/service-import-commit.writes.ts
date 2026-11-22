import { appendAuditLogs } from '@pospay/db';
import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { importedServiceSnapshot } from '../domain/service-import-commit.ts';
import type { ImportedServiceRecord } from '../domain/service-import-commit.ts';

/**
 * يُدخل الخدمات المستوردة وتدقيقها في معاملة الالتزام الواحدة: إدخال دفعة واحدة بصفوف قيم
 * مُعاملة، وتدقيق بإنشاء يدوي (SV-02) بلقطة «بعد» فقط، وبلا أي حدث outbox لكل خدمة (072 FR-009).
 *
 * @param tx        معاملة المستأجر الجارية
 * @param companyId الشركة من مغلف الحدث
 * @param ids       مولّد معرّفات التدقيق المحقون
 * @param records   الخدمات المبنية بمعرّفات محقونة
 */
export async function insertImportedServices(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  records: readonly ImportedServiceRecord[],
): Promise<void> {
  if (records.length === 0) return;
  const values = records.map(
    (record) =>
      sql`(${companyId},${record.id},${record.business_id},${record.name_en},${record.name_ar},
        ${record.price},${record.commission_rule_kind},${record.commission_pct_bps},
        ${record.commission_fixed_amount},${record.counts_toward_threshold},${record.duration_minutes},
        ${record.category_id},${record.created_at},${record.created_at})`,
  );
  await tx.execute(sql`INSERT INTO services
    (company_id,id,business_id,name_en,name_ar,price,commission_rule_kind,commission_pct_bps,
     commission_fixed_amount,counts_toward_threshold,duration_minutes,category_id,created_at,updated_at)
    VALUES ${sql.join(values, sql`,`)}`);
  await appendAuditLogs(
    tx,
    records.map((record) => ({
      id: ids.newId(),
      entry: {
        entity: 'service',
        entityId: record.id,
        action: 'created',
        after: importedServiceSnapshot(record),
      },
    })),
  );
}
