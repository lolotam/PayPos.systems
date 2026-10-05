import { appendAuditLog, type IdGenerator, type TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { RETENTION_BATCH_SIZE } from '../domain/retention.ts';
import type { RetentionRepository } from '../ports/retention.port.ts';

async function safely<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new Error('FILE_RETENTION_RETRY');
  }
}
export function retentionRepository(db: TenantWrappers, ids: IdGenerator): RetentionRepository {
  return {
    claim: (companyId, kind, leaseId, at, cutoff, until) =>
      safely(() =>
        db.withTenant(companyId, async (tx) => {
          const eligible =
            kind === 'abandoned'
              ? sql`status = 'PENDING' AND confirmed_at IS NULL AND created_at <= ${cutoff.toISOString()}::timestamptz`
              : sql`status = 'REJECTED' AND rejected_at <= ${cutoff.toISOString()}::timestamptz`;
          // SKIP LOCKED يتيح عاملين؛ قفل الصف يفصل التأكيد عن الحذف ولا يمتد إلى S3.
          const rows = await tx.execute<{ id: string; staging_key: string }>(sql`
        WITH candidates AS (
          SELECT id FROM file_objects WHERE company_id = ${companyId} AND ${eligible}
            AND purged_at IS NULL AND (lease_until IS NULL OR lease_until <= ${at.toISOString()}::timestamptz)
          ORDER BY ${kind === 'abandoned' ? sql`created_at` : sql`rejected_at`}, id
          LIMIT ${RETENTION_BATCH_SIZE} FOR UPDATE SKIP LOCKED
        ) UPDATE file_objects f SET purge_started_at = COALESCE(f.purge_started_at, ${at.toISOString()}::timestamptz),
          lease_id = ${leaseId}, lease_until = ${until.toISOString()}::timestamptz
        FROM candidates c WHERE f.company_id = ${companyId} AND f.id = c.id
        RETURNING f.id, f.staging_key`);
          return rows.map((row) => ({ id: row.id, stagingKey: row.staging_key }));
        }),
      ),
    complete: (companyId, id, kind, leaseId, at) =>
      safely(() =>
        db.withTenant(companyId, async (tx) => {
          const rows =
            await tx.execute(sql`UPDATE file_objects SET purged_at = ${at.toISOString()}::timestamptz,
        lease_id = NULL, lease_until = NULL WHERE company_id = ${companyId} AND id = ${id}
        AND lease_id = ${leaseId} AND purge_started_at IS NOT NULL AND purged_at IS NULL RETURNING id`);
          if (rows.length !== 1) return false;
          await appendAuditLog(tx, ids.newId(), {
            entity: 'file',
            entityId: id,
            action: 'retention.deleted',
            after: { reason: kind },
          });
          return true;
        }),
      ),
  };
}
