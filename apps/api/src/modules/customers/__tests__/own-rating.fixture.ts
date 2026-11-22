import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  claimRequest,
  consumeRequest,
  insertAttribution,
  insertRating,
  insertRequest,
  RATING_TENANT,
  seedRatingTenants,
  type RatingTenant,
} from '../../../../../../packages/db/test/rating-fixtures.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { phone } from '../../../../test/staff-otp-harness.ts';

export const personalOrigin = 'http://localhost:5173';
const ids = systemUuidV7();

export interface OwnRatingWorld {
  readonly h: Harness;
  readonly db: Database;
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly otherCompany: string;
  readonly otherBusiness: string;
  readonly otherBranch: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly employeeId: string;
  readonly otherEmployeeId: string;
  readonly ownerCookie: string;
  readonly personalCookie: string;
  readonly staffCookie: string;
  setNow(at: Date): void;
  now(): Date;
  seedStars(
    rows: { employeeId: string; stars: number; at: Date }[],
    tenant?: RatingTenant,
  ): Promise<void>;
}

const ids2 = () => systemUuidV7();

/** يزرع تقييماً واحداً بلحظة محددة داخل معاملة الاستهلاك نفسها (القيد يمنع غير كده). */
async function seedStar(
  db: Database,
  counter: { visit: number },
  row: { employeeId: string; stars: number; at: Date },
  tenant: RatingTenant,
) {
  counter.visit += 1;
  await db.withTenant(tenant.company, async (tx) => {
    const tokenHash = randomBytes(32);
    const requestId = await insertRequest(tx, {
      tenant,
      date: `2026-06-${String(counter.visit).padStart(2, '0')}`,
    });
    await claimRequest(tx, {
      tenant,
      requestId,
      tokenHash,
      readyEventId: ids2().newId(),
      now: '2026-06-01T00:00:00Z',
      performers: [row.employeeId],
    });
    await consumeRequest(tx, { tenant, tokenHash, now: '2026-06-02T09:00:00Z' });
    const ratingId = await insertRating(tx, {
      tenant,
      requestId,
      stars: row.stars,
      now: row.at,
    });
    await insertAttribution(tx, {
      tenant,
      requestId,
      ratingId,
      employeeId: row.employeeId,
      stars: row.stars,
      now: row.at,
    });
  });
}

/** يجهّز المستخدم: عضوية staff على الفرع ورقم هاتف وربط معتمد بعد إصدار الجلستين. */
async function seedOwnRatingStaff(
  h: Harness,
  company: string,
  branch: string,
): Promise<{ userId: string; membershipId: string; ownerCookie: string }> {
  const ownerCookie = await h.signedInOperator('rating-owner@example.test');
  await h.signedInOperator('rating-staff@example.test');
  const [holder] = await h.owner`SELECT id FROM "user" WHERE email='rating-staff@example.test'`;
  const userId = holder?.['id'] as string;
  const membershipId = ids.newId();
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${company},${membershipId},${userId},id,'global','BRANCH',${branch},'2026-01-01'
    FROM roles WHERE code='staff' AND company_id IS NULL`;
  await h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  return { userId, membershipId, ownerCookie };
}

/** يصدر جلسة staff ثم جلسة شخصية للمستخدم نفسه؛ جلسة operator قبل الشخصية لأن إصدارها بيلغي ما قبلها. */
async function issueOwnRatingSessions(h: Harness, userId: string, A: typeof RATING_TENANT.A) {
  const staffCookie =
    (
      await h.auth.staff.issue(
        userId,
        {
          companyId: A.company,
          businessId: A.business,
          branchId: A.branch,
          deviceId: ids.newId(),
        },
        async () => true,
      )
    ).cookie.split(';')[0] ?? '';
  const personalCookie =
    (
      await h.auth.personal.issue(
        userId,
        { purpose: 'STAFF_PERSONAL', companyId: A.company, businessId: A.business },
        async () => true,
      )
    ).cookie.split(';')[0] ?? '';
  return { staffCookie, personalCookie };
}

/**
 * عالم 61-2a: موظفة مرتبطة بمستخدم بجلسة شخصية في الشركة A، وتقييمات قابلة للزرع بلحظات محددة.
 * الشركة B فيها نفس المستخدم موظفة كمان، عشان اختبار العزل يثبت فلتر الشركة مش فلتر المستخدم.
 */
export async function ownRatingFixture(options: Parameters<typeof startHarness>[0] = {}) {
  let now = new Date('2026-06-15T12:00:00Z');
  const h = await startHarness({
    personalOrigin,
    customersClock: { now: () => now },
    omitRedis: true,
    ...options,
  });
  const A = RATING_TENANT.A;
  const B = RATING_TENANT.B;
  await seedRatingTenants(h.ownerUrl);
  const { userId, membershipId, ownerCookie } = await seedOwnRatingStaff(h, A.company, A.branch);
  const employeeId = A.employees[0];
  const otherCompanyEmployeeId = B.employees[0];
  await h.owner`UPDATE employees SET user_id=${userId} WHERE company_id=${A.company} AND id=${employeeId}`;
  await h.owner`UPDATE employees SET user_id=${userId} WHERE company_id=${B.company} AND id=${otherCompanyEmployeeId}`;
  for (const [tenant, employee] of [
    [A, employeeId],
    [B, otherCompanyEmployeeId],
  ] as const) {
    await h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
      VALUES (${tenant.company},${ids.newId()},${tenant.business},${employee},${tenant.branch},'2026-01-01')`;
  }
  const { staffCookie, personalCookie } = await issueOwnRatingSessions(h, userId, A);
  await h.owner`UPDATE "user" SET phone_binding_approved_at=${new Date(
    Date.now() - 60_000,
  ).toISOString()} WHERE id=${userId}`;
  expect(await h.auth.personal.resolve(new Headers({ cookie: personalCookie }))).not.toBeNull();
  const db = createDatabase({ url: h.urls.app, ids });
  const counter = { visit: 0 };
  const seedStars = async (
    rows: { employeeId: string; stars: number; at: Date }[],
    tenant: RatingTenant = A,
  ) => {
    for (const row of rows) await seedStar(db, counter, row, tenant);
  };
  return {
    h,
    db,
    company: A.company,
    business: A.business,
    branch: A.branch,
    otherCompany: B.company,
    otherBusiness: B.business,
    otherBranch: B.branch,
    userId,
    membershipId,
    employeeId,
    otherEmployeeId: A.employees[1],
    otherCompanyEmployeeId,
    ownerCookie,
    personalCookie,
    staffCookie,
    setNow: (at: Date) => {
      now = at;
    },
    now: () => now,
    seedStars,
  };
}
export type OwnRatingFixture = Awaited<ReturnType<typeof ownRatingFixture>>;
