import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';

import type { LogoRetirementStore } from '../ports/logo-retirement.port.ts';

export function logoRetirementStore(): LogoRetirementStore {
  return { markIfFree };
}

async function markIfFree(
  tx: Tx,
  companyId: string,
  businessId: string,
  fileId: string,
  at: Date,
): Promise<void> {
  const [row] = await tx.execute<{ purge_started_at: string | null; purged_at: string | null }>(sql`
    SELECT purge_started_at, purged_at FROM file_objects
    WHERE company_id = ${companyId} AND id = ${fileId}
      AND owner_module = 'settings' AND owner_entity_id = ${businessId} AND status = 'READY'
    FOR UPDATE`);
  if (row === undefined || row.purge_started_at !== null || row.purged_at !== null) return;
  await tx.execute(sql`
    UPDATE file_objects SET purge_started_at = ${at.toISOString()}::timestamptz
    WHERE company_id = ${companyId} AND id = ${fileId}
      AND owner_module = 'settings' AND owner_entity_id = ${businessId} AND status = 'READY'
      AND purge_started_at IS NULL AND purged_at IS NULL`);
}
