import postgres from 'postgres';

import { PROVISIONAL_PLAN_ID, seedReferenceData } from '../src/seed.ts';

/**
 * شركتين معزولين (A و B)، لكل واحدة business وفرع — الـ ids ثابتة عشان الرسائل في الاختبارات تبقى واضحة.
 */
export const TENANT = {
  A: {
    company: '01920000-0000-7000-8000-0000000000a0',
    business: '01920000-0000-7000-8000-0000000000a1',
    branch: '01920000-0000-7000-8000-0000000000a2',
  },
  B: {
    company: '01920000-0000-7000-8000-0000000000b0',
    business: '01920000-0000-7000-8000-0000000000b1',
    branch: '01920000-0000-7000-8000-0000000000b2',
  },
} as const;

export const USER = '01920000-0000-7000-8000-0000000000f1';

/**
 * بيجهّز الشركتين كـ pospay_owner جوه داتابيز اختبار متنسخة. الشركات هنا من غير owner membership —
 * ده استثناء للاختبار بس (plan v4 T5): الداتابيز بتتمسح بعد التشغيلة، و memberships مش موجودة لحد T9a.
 *
 * @param ownerUrl اتصال كـ pospay_owner بداتابيز الاختبار
 * @returns بيخلص لما الـ fixtures تبقى موجودة
 */
export async function seedTwoTenants(ownerUrl: string): Promise<void> {
  await seedReferenceData(ownerUrl);
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    for (const [label, ids] of Object.entries(TENANT)) {
      await sql`INSERT INTO companies (id, name_en, owner_user_id, plan_id)
                VALUES (${ids.company}, ${`Company ${label}`}, ${USER}, ${PROVISIONAL_PLAN_ID})`;
      await sql`INSERT INTO businesses (id, company_id, vertical_type, name_en)
                VALUES (${ids.business}, ${ids.company}, 'salon', ${`Business ${label}`})`;
      await sql`INSERT INTO branches (id, company_id, business_id, name_en)
                VALUES (${ids.branch}, ${ids.company}, ${ids.business}, ${`Branch ${label}`})`;
      await sql`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by)
                VALUES (${ids.company}, 'kitchen', false, 'fixture', ${USER})`;
    }
  } finally {
    await sql.end();
  }
}
