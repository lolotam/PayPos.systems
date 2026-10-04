import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** منفذ القراءة بجانب الاستعلام حتى لا تعتمد queries على ports أو auth. */
export interface PasskeyMembershipCompanies {
  /** شركات المستخدم المثبت فقط؛ العضوية المنتهية قد يبقى ربطها نشطاً. */
  forUser(userId: string): Promise<readonly string[]>;
}

/** كل شركة تقرأ بمعاملة RLS مستقلة؛ auth يستقبل معرفات opaque فقط. */
export function createActivePasskeyBindings(
  database: TenantWrappers,
  companies: PasskeyMembershipCompanies,
) {
  return {
    forUser: async (scope: { userId: string; companyId: string }): Promise<readonly string[]> => {
      const candidates = new Set([scope.companyId, ...(await companies.forUser(scope.userId))]);
      const active = new Set<string>();
      for (const companyId of candidates) {
        const ids = await database.withTenant(
          companyId,
          (tx) => activePasskeyIds(tx, companyId, scope.userId),
          { userId: scope.userId },
        );
        for (const id of ids) active.add(id);
      }
      return [...active];
    },
  };
}

/** خيارات التسجيل الشخصي تستبعد الروابط النشطة فقط؛ لا نقرأ جدول auth العالمي. */
export function activePasskeyStatement(companyId: string, userId: string) {
  return sql`
    SELECT DISTINCT b.passkey_id FROM employee_passkeys b
    JOIN employees e ON e.company_id=b.company_id AND e.id=b.employee_id
    WHERE b.company_id=${companyId} AND e.user_id=${userId} AND b.unbound_at IS NULL`;
}

export async function activePasskeyIds(tx: Tx, companyId: string, userId: string) {
  const rows = await tx.execute<{ passkey_id: string }>(activePasskeyStatement(companyId, userId));
  return rows.map((row) => row.passkey_id);
}
