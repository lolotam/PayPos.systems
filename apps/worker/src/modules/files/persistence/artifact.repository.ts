import { appendAuditLog, type TenantWrappers, type IdGenerator } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  ARTIFACT_BATCH_SIZE,
  type ArtifactKind,
  type CleanupArtifact,
} from '../domain/artifacts.ts';
import type { ArtifactRepository } from '../ports/artifact-cleanup.port.ts';

type CleanupRow = {
  id: string;
  file_id: string;
  object_key: string;
  kind: ArtifactKind;
  expiry_at: string;
};
function mapArtifact(row: CleanupRow): CleanupArtifact {
  return {
    id: row.id,
    fileId: row.file_id,
    key: row.object_key,
    kind: row.kind,
    expiryAt: new Date(row.expiry_at),
  };
}

async function safely<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new Error('FILE_ARTIFACT_CLEANUP_RETRY');
  }
}
export function artifactRepository(db: TenantWrappers, ids: IdGenerator): ArtifactRepository {
  return {
    claim: (companyId, leaseId, at, until) =>
      safely(() =>
        db.withTenant(companyId, async (tx) => {
          const rows = await tx.execute<CleanupRow>(sql`
        WITH candidates AS (
          SELECT c.id FROM file_cleanup_objects c JOIN file_objects f ON f.company_id = c.company_id AND f.id = c.file_id
          WHERE c.company_id = ${companyId} AND c.state <> 'PUBLISHED' AND c.cleanup_after <= ${at.toISOString()}::timestamptz
            AND (c.lease_until IS NULL OR c.lease_until <= ${at.toISOString()}::timestamptz)
            AND c.object_key IS DISTINCT FROM f.storage_key
            AND (c.kind = 'STAGING' AND f.status = 'READY' OR c.kind = 'CANDIDATE' AND
              (f.lease_id IS NULL OR f.lease_id IS DISTINCT FROM c.verification_lease_id OR f.lease_until <= ${at.toISOString()}::timestamptz))
          ORDER BY c.cleanup_after, c.id LIMIT ${ARTIFACT_BATCH_SIZE} FOR UPDATE OF c SKIP LOCKED
        ) UPDATE file_cleanup_objects c SET state = 'DELETING', lease_id = ${leaseId}, lease_until = ${until.toISOString()}::timestamptz
          FROM candidates p WHERE c.company_id = ${companyId} AND c.id = p.id AND c.state <> 'PUBLISHED'
          RETURNING c.id, c.file_id, c.object_key, c.kind, c.expiry_at`);
          return rows.map(mapArtifact);
        }),
      ),
    complete: (companyId, id, leaseId, at, next) =>
      safely(() =>
        db.withTenant(companyId, async (tx) => {
          const [row] = await tx.execute<{
            file_id: string;
            kind: ArtifactKind;
            cleaned_at: string | null;
          }>(sql`
        SELECT file_id, kind, cleaned_at FROM file_cleanup_objects WHERE company_id = ${companyId} AND id = ${id}
          AND state = 'DELETING' AND lease_id = ${leaseId} FOR UPDATE`);
          if (row === undefined) return false;
          await tx.execute(sql`UPDATE file_cleanup_objects SET state = 'OWNED', cleaned_at = COALESCE(cleaned_at, ${at.toISOString()}::timestamptz),
        cleanup_after = ${next.toISOString()}::timestamptz, lease_id = NULL, lease_until = NULL WHERE company_id = ${companyId} AND id = ${id}`);
          if (row.cleaned_at === null)
            await appendAuditLog(tx, ids.newId(), {
              entity: 'file',
              entityId: row.file_id,
              action: 'artifact.deleted',
              after: { kind: row.kind, artifactId: id },
            });
          return true;
        }),
      ),
    release: (companyId, id, leaseId) =>
      safely(() =>
        db.withTenant(companyId, async (tx) => {
          await tx.execute(sql`UPDATE file_cleanup_objects SET lease_id = NULL, lease_until = NULL
        WHERE company_id = ${companyId} AND id = ${id} AND state = 'DELETING' AND lease_id = ${leaseId}`);
        }),
      ),
  };
}
