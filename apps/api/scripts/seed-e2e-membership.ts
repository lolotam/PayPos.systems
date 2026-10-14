import { createDatabase, SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';

export interface MembershipRow {
  readonly companyId: string;
  readonly userId: string;
  readonly roleCode: string;
  readonly branchId: string;
  readonly limitBps: number | null;
}

function roleId(code: string): string {
  const role = SYSTEM_ROLES.find((item) => item.code === code);
  if (role === undefined) throw new Error('e2e:seed role missing');
  return role.id;
}

// مفيش API بيعمل عضوية غير المالك، فالـ seed بيكتبها بدور التطبيق جوه withTenant زي ما onboarding بيعمل،
// عشان الـ RLS والصلاحيات اللي الـ API بيشتغل بيها هي اللي تحكم الصف، مش صاحب الـ migration.
// كل مستأجر في transaction واحدة: يا الصفوف بتاعته كلها تتكتب يا ولا واحد.
export async function insertMemberships(appUrl: string, rows: readonly MembershipRow[]): Promise<string[]> {
  const ids = systemUuidV7();
  const database = createDatabase({ url: appUrl, ids });
  try {
    const written = new Map<MembershipRow, string>();
    for (const companyId of new Set(rows.map((row) => row.companyId))) {
      await database.withTenant(companyId, async (tx) => {
        for (const row of rows.filter((item) => item.companyId === companyId)) {
          const id = ids.newId();
          await tx.execute(sql`INSERT INTO memberships
            (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, limit_bps)
            VALUES (${row.companyId}, ${id}, ${row.userId}, ${roleId(row.roleCode)}, 'global', 'BRANCH', ${row.branchId}, ${row.limitBps})`);
          written.set(row, id);
        }
      });
    }
    return rows.map((row) => written.get(row) ?? '');
  } finally {
    await database.close();
  }
}
