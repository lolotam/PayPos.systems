import { randomBytes } from 'node:crypto';
import type { Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import {
  claimRequest,
  consumeRequest,
  insertAttribution,
  insertRating,
  insertRequest,
  type RatingTenant,
} from '../../../../../../../packages/db/test/rating-fixtures.ts';

const ids = systemUuidV7();
let visit = 0;

export interface RatingSeed {
  readonly stars: number;
  readonly at: Date;
  readonly performers: readonly string[];
  readonly comment?: string | null;
  readonly branch?: string;
  readonly date?: string;
}

/**
 * يزرع تقييم كامل بحياته (عميل، طلب، منفّذات، تقييم، تسنيد) في معاملة واحدة على الشركة، ويرجّع معرّف التقييم.
 * كل تقييم بعميل جديد عشان قيد اليوم الواحد لكل عميل ما يمنعش تقييمين في نفس اليوم.
 */
export async function seedRating(db: Database, tenant: RatingTenant, seed: RatingSeed) {
  visit += 1;
  const branch = seed.branch ?? tenant.branch;
  const place = { ...tenant, branch };
  return db.withTenant(tenant.company, async (tx) => {
    const customer = ids.newId();
    await tx.execute(sql`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
      VALUES (${tenant.company},${customer},'Synthetic rater',${'+1888' + String(visit).padStart(7, '0')},'ar',now(),now())`);
    const tokenHash = randomBytes(32);
    const requestId = await insertRequest(tx, {
      tenant: place,
      customer,
      branch,
      date: seed.date ?? '2026-06-15',
    });
    await claimRequest(tx, {
      tenant: place,
      requestId,
      tokenHash,
      readyEventId: ids.newId(),
      now: '2026-06-01T00:00:00Z',
      performers: seed.performers,
    });
    await consumeRequest(tx, { tenant: place, tokenHash, now: '2026-06-02T09:00:00Z' });
    const ratingId = await insertRating(tx, {
      tenant: place,
      requestId,
      stars: seed.stars,
      comment: seed.comment ?? null,
      now: seed.at,
      branch,
    });
    for (const employeeId of seed.performers)
      await insertAttribution(tx, {
        tenant: place,
        requestId,
        ratingId,
        employeeId,
        stars: seed.stars,
        now: seed.at,
        branch,
      });
    return ratingId;
  });
}
