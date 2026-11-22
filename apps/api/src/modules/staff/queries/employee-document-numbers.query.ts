import { employeeDocumentNumbers } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { EmployeeDocumentReadAccess } from './employee-documents.query.ts';

// جرس انتهاء المستند في الإدارة (62-2e): أرقام الوثائق الحالية فقط، بعد إثبات صلاحية الملفات وقبل قراءة أي صف وثيقة.
export function employeeDocumentNumbersStatement(
  c: { companyId: string; businessId: string },
  ids: readonly string[],
) {
  return sql`SELECT d.id AS document_id, d.document_number
    FROM employee_documents d
    JOIN employees e ON e.company_id=d.company_id AND e.business_id=d.business_id AND e.id=d.employee_id
    WHERE d.company_id=${c.companyId} AND d.business_id=${c.businessId}
      AND d.id IN ${ids}
      AND d.replaced_at IS NULL AND e.deleted_at IS NULL AND d.document_number IS NOT NULL`;
}

export async function readEmployeeDocumentNumbers(
  tx: Tx,
  c: { companyId: string; userId: string; businessId: string },
  ids: readonly string[],
  access: EmployeeDocumentReadAccess,
) {
  const decision = await access.check(tx, c.companyId, c.userId, c.businessId);
  if (!decision.read) return null;
  if (!decision.featureEnabled) return 'FEATURE_DISABLED' as const;
  const rows = await tx.execute<{ document_id: string; document_number: string }>(
    employeeDocumentNumbersStatement(c, ids),
  );
  return employeeDocumentNumbers.parse({
    items: rows.map((row) => ({
      document_id: row.document_id,
      document_number: row.document_number,
    })),
  });
}
