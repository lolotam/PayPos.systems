import type { Sql } from 'postgres';

/**
 * باسوردات الـ roles اللي بيستخدمها التطبيق — جاية من env بس، والـ repo عام.
 */
export interface RolePasswords {
  readonly app: string;
  readonly auth: string;
}

// الـ roles على مستوى الـ cluster كله، مش الداتابيز، فالسكريبت لازم يتعاد تشغيله من غير ما يقع.
// الـ ALTER بيتنفذ كل مرة عشان الصفات تطابق السكريبت حتى لو الـ volume فيه role قديم متعدّل بإيد.
// الباسورد بيعدّي بـ set_config عشان format(%L) هو اللي يعمل الـ quoting، مش كود JavaScript.
// أي عضوية في role تاني بتتشال كل مرة: NOINHERIT بيمنع وراثة الصلاحيات بس، مش SET ROLE،
// فعضوية فضلت من grant يدوي كانت هتخلي الـ app ياخد صلاحيات role أعلى.
const ROLES_SQL = `
DO $$
DECLARE r record; m record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('pospay_app', 'pospay.app_password'),
    ('pospay_auth', 'pospay.auth_password')
  ) AS v(name, setting) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.name) THEN
      EXECUTE format('CREATE ROLE %I', r.name);
    END IF;
    EXECUTE format(
      'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      r.name, current_setting(r.setting));
    FOR m IN
      SELECT g.rolname AS granted, gr.rolname AS grantor FROM pg_auth_members am
      JOIN pg_roles g ON g.oid = am.roleid JOIN pg_roles u ON u.oid = am.member
      JOIN pg_roles gr ON gr.oid = am.grantor
      WHERE u.rolname = r.name
    LOOP
      EXECUTE format('REVOKE %I FROM %I GRANTED BY %I', m.granted, r.name, m.grantor);
    END LOOP;
  END LOOP;
END $$`;

/**
 * بيعمل pospay_app و pospay_auth لو مش موجودين، ويثبّت صفاتهم حسب ADR-0003 §3.
 * لازم يتشغّل كـ pospay_owner قبل الـ migrations، لأن الـ GRANTs فيها بتشاور على الـ roles دي.
 *
 * @param sql       اتصال كـ pospay_owner
 * @param passwords باسوردات الـ roles من env
 * @returns بيخلص لما الـ roles تبقى جاهزة
 */
export async function bootstrapRoles(sql: Sql, passwords: RolePasswords): Promise<void> {
  if (passwords.app.length < 16 || passwords.auth.length < 16) {
    throw new Error(
      'POSTGRES_APP_PASSWORD and POSTGRES_AUTH_PASSWORD must be at least 16 characters',
    );
  }
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('pospay:bootstrap-roles'))`;
    await tx`SELECT set_config('pospay.app_password', ${passwords.app}, true),
                    set_config('pospay.auth_password', ${passwords.auth}, true)`;
    await tx.unsafe(ROLES_SQL);
  });
}
