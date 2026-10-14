import { SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';

export interface MembershipRow {
  readonly companyId: string;
  readonly userId: string;
  readonly roleCode: string;
  readonly branchId: string;
  readonly limitBps: number | null;
}

async function insertOne(sql: postgres.TransactionSql, row: MembershipRow): Promise<string> {
  const role = SYSTEM_ROLES.find((item) => item.code === row.roleCode);
  if (role === undefined) throw new Error('e2e:seed role missing');
  const rows = await sql<{ id: string }[]>`INSERT INTO memberships
    (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, limit_bps)
    VALUES (${row.companyId}, ${systemUuidV7().newId()}, ${row.userId}, ${role.id}, 'global', 'BRANCH', ${row.branchId}, ${row.limitBps})
    RETURNING id`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('e2e:seed membership missing');
  return id;
}

export async function insertMemberships(migrationUrl: string, rows: readonly MembershipRow[]): Promise<string[]> {
  const sql = postgres(migrationUrl, { max: 1, onnotice: () => undefined });
  try {
    // الصفوف التلاتة يا تتكتب كلها يا ولا واحد، عشان تشغيل فاشل ما يسيبش عضوية ناقصة للمستأجر الجديد.
    return await sql.begin(async (tx) => {
      const ids: string[] = [];
      for (const row of rows) ids.push(await insertOne(tx, row));
      return ids;
    });
  } finally {
    await sql.end();
  }
}
