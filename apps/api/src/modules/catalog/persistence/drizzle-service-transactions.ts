import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ServiceError } from '../domain/errors.ts';
import {
  serviceColumnValues,
  serviceRecordFromRow,
  serviceSnapshot,
  type ServiceRecord,
} from '../domain/service.ts';
import type { ServiceTransactions } from '../ports/service-transactions.port.ts';

type ServiceRow = {
  id: string;
  business_id: string;
  name_en: string;
  name_ar: string | null;
  price: string;
  commission_rule_kind: string;
  commission_pct_bps: number | null;
  commission_fixed_amount: string | null;
  counts_toward_threshold: boolean;
  revision: number;
  created_at: Date;
  updated_at: Date;
};

const SELECT_ROW = sql`id,business_id,name_en,name_ar,price,commission_rule_kind,
  commission_pct_bps,commission_fixed_amount,counts_toward_threshold,revision,created_at,updated_at`;

async function insertService(tx: Tx, companyId: string, record: ServiceRecord): Promise<void> {
  const values = serviceColumnValues(record);
  await tx.execute(sql`INSERT INTO services
    (company_id,id,business_id,name_en,name_ar,price,commission_rule_kind,commission_pct_bps,
     commission_fixed_amount,counts_toward_threshold,revision,created_at,updated_at)
    VALUES (${companyId},${record.id},${record.business_id},${record.name_en},${record.name_ar},
      ${values.price},${values.commission_rule_kind},${values.commission_pct_bps},
      ${values.commission_fixed_amount},${record.counts_toward_threshold},${record.revision},
      ${record.created_at},${record.updated_at})`);
}

async function loadService(
  tx: Tx,
  companyId: string,
  businessId: string,
  serviceId: string,
): Promise<ServiceRecord | null> {
  const rows = await tx.execute<ServiceRow>(sql`SELECT ${SELECT_ROW} FROM services
    WHERE company_id=${companyId} AND business_id=${businessId} AND id=${serviceId} FOR UPDATE`);
  const row = rows[0];
  return row === undefined ? null : serviceRecordFromRow(row);
}

async function saveService(
  tx: Tx,
  companyId: string,
  before: ServiceRecord,
  after: ServiceRecord,
): Promise<void> {
  const values = serviceColumnValues(after);
  const rows = await tx.execute<{ id: string }>(sql`UPDATE services SET
    name_en=${after.name_en},name_ar=${after.name_ar},price=${values.price},
    commission_rule_kind=${values.commission_rule_kind},commission_pct_bps=${values.commission_pct_bps},
    commission_fixed_amount=${values.commission_fixed_amount},
    counts_toward_threshold=${after.counts_toward_threshold},revision=${after.revision},
    updated_at=${after.updated_at}
    WHERE company_id=${companyId} AND business_id=${before.business_id} AND id=${before.id}
      AND revision=${before.revision} RETURNING id`);
  // القفل بيمنع السباق، والشرط بيمنع الكتابة فوق نسخة اتغيرت بين التحميل والحفظ.
  if (rows.length === 0) throw new ServiceError('SERVICE_REVISION_CONFLICT');
}

// أخطاء السائق ممكن تحمل قيم dbinfo/extensions؛ منعديش أي جزء منها بره طبقة الـ persistence.
function cleanServiceError(error: unknown): never {
  if (error instanceof ServiceError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = (cause as { code?: unknown }).code;
    if (code === '40P01' || code === '40001') throw new ServiceError('TRANSACTION_RETRY_REQUIRED');
    // قيمة خارج قيود numeric أو CHECK تعني مدخلات مش متحققة — نردها كرفض مسمّى مش 500.
    if (code === '23514' || code === '22003') throw new ServiceError('SERVICE_PRICE_INVALID');
    // الـ FK المركّب على النشاط: مفيش نشاط بهوية دي في الشركة.
    if (code === '23503') throw new ServiceError('SERVICE_NOT_FOUND');
  }
  throw new Error('SERVICE_PERSISTENCE_FAILED');
}

export function createServiceTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): ServiceTransactions {
  return {
    run: async ({ companyId, userId }, work) =>
      database.withTenant(
        companyId,
        async (tx) => {
          try {
            return await work({
              insert: (record) => insertService(tx, companyId, record),
              load: (businessId, serviceId) => loadService(tx, companyId, businessId, serviceId),
              save: (before, after) => saveService(tx, companyId, before, after),
              audit: (before, after) =>
                appendAuditLog(tx, ids.newId(), {
                  entity: 'service',
                  entityId: after.id,
                  action: before === null ? 'created' : 'updated',
                  ...(before === null ? {} : { before: serviceSnapshot(before) }),
                  after: serviceSnapshot(after),
                }),
            });
          } catch (error) {
            cleanServiceError(error);
          }
        },
        { userId },
      ),
  };
}
