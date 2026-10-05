import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { VerificationRepository } from '../ports/verification.port.ts';
import { reserveCandidate, publishCandidate } from './candidate-ownership.ts';

async function safely<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new Error('FILE_VERIFICATION_RETRY');
  }
}
export function verificationRepository(db: TenantWrappers): VerificationRepository {
  return {
    claim: (companyId, fileId, leaseId, at, until) =>
      safely(() =>
        db.withTenant(companyId, async (tx) => {
          const [row] = await tx.execute<{
            id: string;
            business_id: string;
            staging_key: string;
            content_type: string;
            size_bytes: string;
            status: string;
            lease_until: string | Date | null;
          }>(sql`SELECT id, business_id, staging_key, content_type, size_bytes, status, lease_until
        FROM file_objects WHERE company_id = ${companyId} AND id = ${fileId} AND purge_started_at IS NULL FOR UPDATE`);
          if (row === undefined || ['READY', 'REJECTED'].includes(row.status)) return null;
          // raw SQL يعيد timestamptz كنص؛ نحوله قبل مقارنة مطالبة العامل.
          if (
            row.status === 'VERIFYING' &&
            row.lease_until !== null &&
            new Date(row.lease_until).getTime() > at.getTime()
          )
            throw new Error('FILE_LEASE_BUSY');
          await tx.execute(sql`UPDATE file_objects SET status = 'VERIFYING', confirmed_at = COALESCE(confirmed_at, ${at.toISOString()}::timestamptz), lease_id = ${leaseId}, lease_until = ${until.toISOString()}
        WHERE company_id = ${companyId} AND id = ${fileId}`);
          return {
            id: row.id,
            businessId: row.business_id,
            stagingKey: row.staging_key,
            type: row.content_type,
            size: Number(row.size_bytes),
          };
        }),
      ),
    reserve: (companyId, id, leaseId, candidateId, key, at, until) =>
      safely(() =>
        db.withTenant(companyId, (tx) =>
          reserveCandidate(tx, companyId, id, leaseId, candidateId, key, at, until),
        ),
      ),
    complete: (companyId, id, leaseId, result, at) =>
      safely(() =>
        db.withTenant(companyId, (tx) => publishCandidate(tx, companyId, id, leaseId, result, at)),
      ),
    reject: (companyId, id, leaseId, code, at) =>
      safely(() =>
        db.withTenant(companyId, async (tx) => {
          await tx.execute(sql`UPDATE file_objects SET status = 'REJECTED', rejected_at = ${at.toISOString()}, rejection_code = ${code}, lease_id = NULL, lease_until = NULL
        WHERE company_id = ${companyId} AND id = ${id} AND lease_id = ${leaseId} AND status = 'VERIFYING'`);
        }),
      ),
    release: (companyId, id, leaseId) =>
      safely(() =>
        db.withTenant(companyId, async (tx) => {
          await tx.execute(sql`UPDATE file_objects SET status = 'PENDING', lease_id = NULL, lease_until = NULL
        WHERE company_id = ${companyId} AND id = ${id} AND lease_id = ${leaseId} AND status = 'VERIFYING'`);
        }),
      ),
  };
}
