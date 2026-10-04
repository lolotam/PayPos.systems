import { appendOutboxEvent, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import type { EmployeeRecord } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { employeeImportBranches } from '../../tenancy/index.ts';
import type { ImportCommitPreview } from '../domain/employee-import.ts';
import type { ImportCommitTransactions } from '../ports/employee-import.port.ts';
import { insertEmployees } from './employee-import-writes.ts';

async function complete(
  tx: Tx,
  ids: IdGenerator,
  preview: ImportCommitPreview,
  records: readonly EmployeeRecord[],
  at: string,
) {
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'import_preview',
    aggregateId: preview.id,
    eventType: 'ImportCommitted',
    payload: {
      preview_id: preview.id,
      business_id: preview.business_id,
      entity: 'employees',
      created_count: records.length,
      employee_ids: records.map((r) => r.id),
      committed_at: at,
    },
  });
  await tx.execute(sql`UPDATE import_previews SET status='committed',committed_at=${at},created_count=${records.length}
    WHERE company_id=app_company_id() AND id=${preview.id}`);
}

export function employeeImportTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
): ImportCommitTransactions {
  return {
    run: (companyId, previewId, work) =>
      database.withTenant(
        companyId,
        async (tx) => {
          const [preview] = await tx.execute<
            ImportCommitPreview & Record<string, unknown>
          >(sql`SELECT id,business_id,created_by,status,expires_at,rows,errors
        FROM import_previews WHERE company_id=${companyId} AND id=${previewId} AND entity='employees' FOR UPDATE`);
          // التدقيق يحمل صاحب الطلب المقبول؛ الهوية تأتي من الصف المقفل لا من payload الوظيفة.
          if (preview !== undefined)
            await tx.execute(sql`SELECT set_config('app.user_id',${preview.created_by},true)`);
          await work({
            preview: preview ?? null,
            branches: (businessId) => employeeImportBranches(tx, businessId),
            insert: (records) => insertEmployees(tx, companyId, ids, records),
            complete: (stored, records, at) => complete(tx, ids, stored, records, at),
          });
        },
        { timeoutMs: 15000 },
      ),
    fail: (companyId, previewId, code) =>
      database.withTenant(companyId, async (tx) => {
        await tx.execute(sql`UPDATE import_previews SET status='failed',error_code=${code}
        WHERE company_id=${companyId} AND id=${previewId} AND status='commit_requested'`);
      }),
  };
}
