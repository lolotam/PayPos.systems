import postgres from 'postgres';

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

// id ثابت عشان الـ seed يبقى idempotent ويتعاد تشغيله من غير ما يعمل plan تاني.
export const PROVISIONAL_PLAN_ID = '01920000-0000-7000-8000-000000000001';

/**
 * بيحط الـ plan المؤقت: كل flag مفعّل (قرار Waleed 2026-09-23) لحد ما D-06 يحدد الـ plans الحقيقية.
 * مبيعملش أي شركة — الشركة من غير owner ممنوعة (ADR-0003 §5.3)، والـ demo بييجي في T8 عن طريق onboard-company.
 *
 * @param ownerUrl اتصال كـ pospay_owner — الـ app معندوش صلاحية كتابة على plans
 * @returns بيخلص لما الـ plan يبقى موجود ومحدّث
 */
export async function seedReferenceData(ownerUrl: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  const flags = Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag, true]));
  try {
    await sql`
      INSERT INTO plans (id, code, name_ar, name_en, feature_flags)
      VALUES (${PROVISIONAL_PLAN_ID}, 'provisional', 'مؤقتة', 'Provisional', ${sql.json(flags)})
      ON CONFLICT (code) DO UPDATE SET feature_flags = EXCLUDED.feature_flags`;
  } finally {
    await sql.end();
  }
}
