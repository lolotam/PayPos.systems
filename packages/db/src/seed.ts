import postgres from 'postgres';

import { OWNER_ROLE_ID, PERMISSIONS, PLATFORM_ROLES, SYSTEM_ROLES } from './access-catalog.ts';

/**
 * كل الـ modules اللي ليها feature flag — أسماءها نفس أسماء الـ modules في docs/module-map.md.
 * الـ core (tenancy, identity, settings, platform) مالهاش flag لأنها مبتتقفلش.
 */
export const FEATURE_FLAGS = [
  'appointments',
  'cash',
  'catalog',
  'channels',
  'commissions',
  'customers',
  'expenses',
  'files',
  'inventory',
  'kitchen',
  'loyalty',
  'notifications',
  'orders',
  'payments',
  'realtime',
  'reporting',
  'staff',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

// id ثابت عشان الـ seed يبقى idempotent ويتعاد تشغيله من غير ما يعمل plan تاني.
export const PROVISIONAL_PLAN_ID = '01920000-0000-7000-8000-000000000001';

/**
 * بيحط الـ plan المؤقت: كل flag مفعّل (قرار Waleed 2026-09-23) لحد ما D-06 يحدد الـ plans الحقيقية.
 * وبيزرع catalog الصلاحيات والـ roles النظامية من الكود، والـ Owner بياخد كل صلاحية في الـ catalog.
 * مبيعملش أي شركة — الشركة من غير owner ممنوعة (ADR-0003 §5.3)، والـ demo بييجي في T8 عن طريق onboard-company.
 *
 * @param ownerUrl اتصال كـ pospay_owner — الـ app معندوش صلاحية كتابة على plans ولا على الصفوف النظامية
 * @returns بيخلص لما الـ plan والـ catalog يبقوا موجودين ومحدّثين
 */
export async function seedReferenceData(ownerUrl: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  const flags = Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag, true]));
  try {
    await sql`
      INSERT INTO plans (id, code, name_ar, name_en, feature_flags)
      VALUES (${PROVISIONAL_PLAN_ID}, 'provisional', 'مؤقتة', 'Provisional', ${sql.json(flags)})
      ON CONFLICT (code) DO UPDATE SET feature_flags = EXCLUDED.feature_flags`;
    await seedAccessCatalog(sql);
  } finally {
    await sql.end();
  }
}

async function seedAccessCatalog(sql: postgres.Sql): Promise<void> {
  await sql.begin(async (tx) => {
    for (const code of PERMISSIONS) {
      await tx`INSERT INTO permissions (code) VALUES (${code}) ON CONFLICT DO NOTHING`;
    }
    for (const role of SYSTEM_ROLES) {
      await tx`
        INSERT INTO roles (id, company_id, code, name_en) VALUES (${role.id}, NULL, ${role.code}, ${role.nameEn})
        ON CONFLICT (id, owner_key) DO UPDATE SET code = EXCLUDED.code, name_en = EXCLUDED.name_en`;
    }
    for (const role of PLATFORM_ROLES) {
      await tx`
        INSERT INTO platform_roles (code, name_en) VALUES (${role.code}, ${role.nameEn})
        ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en`;
    }
    await tx`
      INSERT INTO role_permissions (role_id, role_owner_key, company_id, permission_code)
      SELECT ${OWNER_ROLE_ID}, 'global', NULL, code FROM permissions
      -- a platform permission is a platform grant (ADR-0003 §3), never part of a tenant role
      WHERE code NOT LIKE '%:platform'
      ON CONFLICT DO NOTHING`;
  });
}
