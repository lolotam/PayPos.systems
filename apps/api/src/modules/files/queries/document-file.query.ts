import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// staff تتحقق من ملف وثيقة الموظف قبل ربطه؛ القراءة داخل معاملة الشركة وتحت RLS، والمفتاح يظهر بعد READY فقط.
export function documentFileStatement(companyId: string, fileId: string) {
  return sql`SELECT business_id, branch_id, owner_module, owner_entity_id, required_permission, created_by,
    status, CASE WHEN status='READY' THEN storage_key END AS storage_key, purged_at IS NOT NULL AS purged
    FROM file_objects WHERE company_id=${companyId} AND id=${fileId}`;
}

export async function documentFileFacts(tx: Tx, companyId: string, fileId: string) {
  const [row] = await tx.execute<{
    business_id: string;
    branch_id: string | null;
    owner_module: string;
    owner_entity_id: string;
    required_permission: string;
    created_by: string;
    status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
    storage_key: string | null;
    purged: boolean;
  }>(documentFileStatement(companyId, fileId));
  return row ?? null;
}
