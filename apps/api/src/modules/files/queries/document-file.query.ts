import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * حقائق الملف التي يستهلكها ربط الوثيقة وربط الشعار داخل معاملة الشركة.
 * purge_started يُشتق من purge_started_at حتى يُرفض الربط بعد بدء الحذف وقبل اكتمال purged_at.
 */
export type DocumentFileFacts = {
  business_id: string;
  branch_id: string | null;
  owner_module: string;
  owner_entity_id: string;
  required_permission: string;
  created_by: string;
  content_type: string;
  size_bytes: number;
  status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
  storage_key: string | null;
  purged: boolean;
  purge_started: boolean;
};

// staff تتحقق من ملف وثيقة الموظف قبل ربطه، وربط الشعار يقرأ purge_started من نفس الصف؛ القراءة تحت RLS والمفتاح يظهر بعد READY فقط.
export function documentFileStatement(companyId: string, fileId: string) {
  return sql`SELECT business_id, branch_id, owner_module, owner_entity_id, required_permission, created_by,
    content_type, size_bytes::int AS size_bytes, status, CASE WHEN status='READY' THEN storage_key END AS storage_key, purged_at IS NOT NULL AS purged,
    purge_started_at IS NOT NULL AS purge_started
    FROM file_objects WHERE company_id=${companyId} AND id=${fileId}`;
}

export async function documentFileFacts(
  tx: Tx,
  companyId: string,
  fileId: string,
): Promise<DocumentFileFacts | null> {
  const [row] = await tx.execute<DocumentFileFacts>(documentFileStatement(companyId, fileId));
  return row ?? null;
}
