import { documentTypeList } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// شاشة أنواع الوثائق: كل أنواع الشركة، المفعلة أولاً؛ السقف المئوي يبقيها صفحة واحدة.
export function documentTypesStatement(companyId: string) {
  return sql`SELECT id, code, name_en, name_ar, alert_days, requires_expiry, active, revision
    FROM document_types WHERE company_id=${companyId}
    ORDER BY active DESC, name_en, id LIMIT 100`;
}

export async function listDocumentTypes(tx: Tx, companyId: string) {
  const items = await tx.execute(documentTypesStatement(companyId));
  return documentTypeList.parse({ items });
}
