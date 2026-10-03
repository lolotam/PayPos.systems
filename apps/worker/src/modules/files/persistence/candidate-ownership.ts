import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { candidateCleanupAfter, stagingExpiry } from '../domain/artifacts.ts';
import type { VerifiedFile } from '../domain/verification.ts';

export async function reserveCandidate(
  tx: Tx,
  companyId: string,
  fileId: string,
  leaseId: string,
  candidateId: string,
  key: string,
  at: Date,
  until: Date,
): Promise<boolean> {
  const rows =
    await tx.execute(sql`UPDATE file_objects SET lease_until = ${until.toISOString()}::timestamptz
    WHERE company_id = ${companyId} AND id = ${fileId} AND lease_id = ${leaseId} AND status = 'VERIFYING'
    AND purge_started_at IS NULL AND lease_until > ${at.toISOString()}::timestamptz RETURNING id`);
  if (rows.length !== 1) return false;
  const after = candidateCleanupAfter(until);
  await tx.execute(sql`INSERT INTO file_cleanup_objects(company_id,id,file_id,object_key,kind,verification_lease_id,expiry_at,cleanup_after)
    VALUES (${companyId},${candidateId},${fileId},${key},'CANDIDATE',${leaseId},${after.toISOString()},${after.toISOString()})`);
  return true;
}

export async function publishCandidate(
  tx: Tx,
  companyId: string,
  fileId: string,
  leaseId: string,
  result: VerifiedFile,
  at: Date,
): Promise<boolean> {
  // نفس قفل سجل المرشح يفصل النشر عن مطالبة الحذف، قبل لمس صف الملف.
  const [candidate] = await tx.execute<{ id: string }>(sql`SELECT id FROM file_cleanup_objects
    WHERE company_id = ${companyId} AND file_id = ${fileId} AND object_key = ${result.key}
      AND verification_lease_id = ${leaseId} AND kind = 'CANDIDATE' AND state = 'OWNED' AND cleaned_at IS NULL FOR UPDATE`);
  if (candidate === undefined) return false;
  const [file] = await tx.execute<{ staging_key: string; created_at: string }>(sql`
    SELECT staging_key, created_at FROM file_objects WHERE company_id = ${companyId} AND id = ${fileId}
      AND status = 'VERIFYING' AND lease_id = ${leaseId} AND purge_started_at IS NULL
      AND lease_until > ${at.toISOString()}::timestamptz FOR UPDATE`);
  if (file === undefined) return false;
  await tx.execute(
    sql`UPDATE file_cleanup_objects SET state = 'PUBLISHED' WHERE company_id = ${companyId} AND id = ${candidate.id}`,
  );
  await tx.execute(sql`UPDATE file_objects SET status = 'READY', storage_key = ${result.key}, content_type = ${result.type},
    size_bytes = ${result.size}, lease_id = NULL, lease_until = NULL WHERE company_id = ${companyId} AND id = ${fileId}`);
  await tx.execute(sql`INSERT INTO file_cleanup_objects(company_id,id,file_id,object_key,kind,expiry_at,cleanup_after)
    VALUES (${companyId},${fileId},${fileId},${file.staging_key},'STAGING',${stagingExpiry(new Date(file.created_at)).toISOString()},${at.toISOString()})`);
  return true;
}
