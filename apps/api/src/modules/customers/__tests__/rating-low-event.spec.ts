import { lowRatingSubmitted } from '@pospay/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RATING_TENANT } from '../../../../../../packages/db/test/rating-fixtures.ts';
import {
  BEFORE_EXPIRY,
  consumedAt,
  linkFor,
  ratingsForRequest,
  startRatingContext,
  submitRequest,
  type RatingContext,
} from './rating-submission.fixture.ts';

let context: RatingContext;
const tenant = RATING_TENANT.A;

beforeAll(async () => {
  context = await startRatingContext();
});
afterAll(async () => {
  await context.harness.close();
});

/** صفوف أوتبوكس حدث التقييم المنخفض اللي اتكتبت لتقييم معين. */
function lowRatingEvents(ratingId: string) {
  return context.harness.owner`SELECT aggregate_type, aggregate_id, event_type, payload FROM outbox
    WHERE company_id=${tenant.company} AND aggregate_id=${ratingId} AND event_type='LowRatingSubmitted'`;
}

/** كل أحداث التقييم المنخفض للشركة، عشان اختبار «ولا حدث» ما يعتمدش على معرّف تقييم موجود. */
async function allLowRatingEvents(): Promise<number> {
  const rows = await context.harness.owner`SELECT id FROM outbox
    WHERE company_id=${tenant.company} AND event_type='LowRatingSubmitted'`;
  return rows.length;
}

async function submitFresh(stars: number, comment?: string) {
  context.setNow(BEFORE_EXPIRY);
  const link = await linkFor(context.harness, 'A');
  const response = await submitRequest(context.harness, link.token, {
    stars,
    ...(comment === undefined ? {} : { comment }),
  });
  const [rating] = await ratingsForRequest(context.harness, link.companyId, link.requestId);
  return { link, response, ratingId: rating?.['id'] as string | undefined };
}

describe('a low rating', () => {
  it.each([1, 2])(
    'writes one LowRatingSubmitted event with the exact payload for %i stars',
    async (stars) => {
      const { link, response, ratingId } = await submitFresh(stars, 'اتصلوا بيا على 99887766');
      expect(response.status).toBe(204);
      if (ratingId === undefined) throw new Error('THE_RATING_WAS_NOT_STORED');
      const events = await lowRatingEvents(ratingId);
      expect(events).toHaveLength(1);
      expect(events[0]?.['aggregate_type']).toBe('rating');
      const payload = lowRatingSubmitted.parse(events[0]?.['payload']);
      expect(payload).toEqual({
        schema_version: 1,
        rating_id: ratingId,
        request_id: link.requestId,
        business_id: tenant.business,
        branch_id: tenant.branch,
        stars,
      });
      expect(JSON.stringify(events[0]?.['payload'])).not.toMatch(/99887766|token|comment/i);
    },
  );

  it('writes one event even when a second submit races the first', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');
    const responses = await Promise.all([
      submitRequest(context.harness, link.token, { stars: 2 }),
      submitRequest(context.harness, link.token, { stars: 1 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 404]);
    const [rating] = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(await lowRatingEvents(rating?.['id'] as string)).toHaveLength(1);
  });

  it('adds only the outbox lock and the outbox insert to the public transaction', async () => {
    const { statements } = context.harness.calls;
    const measure = async (stars: number): Promise<string[]> => {
      const before = statements.length;
      await submitFresh(stars);
      return statements.slice(before).map((statement) => statement.sql);
    };
    const high = await measure(5);
    const low = await measure(2);
    expect(high.length).toBeGreaterThan(0);
    const extra = low.filter((sql) => !high.includes(sql));
    expect(extra).toHaveLength(2);
    expect(extra.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(extra.some((sql) => sql.includes('INSERT INTO outbox'))).toBe(true);
    expect(low.length).toBe(high.length + 2);
  });
});

describe('a rating that is not low or not stored', () => {
  it.each([3, 4, 5])('writes no event for %i stars', async (stars) => {
    const before = await allLowRatingEvents();
    const { response } = await submitFresh(stars);
    expect(response.status).toBe(204);
    expect(await allLowRatingEvents()).toBe(before);
  });

  it('writes no event for an unavailable link', async () => {
    const before = await allLowRatingEvents();
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');
    const response = await submitRequest(context.harness, link.token.toUpperCase(), { stars: 1 });
    expect(response.status).toBe(404);
    expect(await allLowRatingEvents()).toBe(before);
  });

  it('writes no event for a sequential replay of the same link', async () => {
    const { link, ratingId } = await submitFresh(1);
    const replay = await submitRequest(context.harness, link.token, { stars: 1 });
    expect(replay.status).toBe(404);
    expect(await lowRatingEvents(ratingId as string)).toHaveLength(1);
  });
});

describe('the rollback of a low rating', () => {
  it('leaves no rating, consumption or event when the event cannot be written, then takes the retry', async () => {
    const { owner } = context.harness;
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');
    const before = await allLowRatingEvents();
    await owner`ALTER TABLE outbox ADD CONSTRAINT zz_low_rating_event_fails
      CHECK (event_type <> 'LowRatingSubmitted') NOT VALID`;
    let failed: { status: number } | undefined;
    try {
      failed = await submitRequest(context.harness, link.token, { stars: 2 });
    } finally {
      await owner`ALTER TABLE outbox DROP CONSTRAINT zz_low_rating_event_fails`;
    }
    expect(failed?.status).toBe(500);
    expect(await ratingsForRequest(context.harness, link.companyId, link.requestId)).toHaveLength(
      0,
    );
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).toBeNull();
    expect(await allLowRatingEvents()).toBe(before);

    expect((await submitRequest(context.harness, link.token, { stars: 2 })).status).toBe(204);
    const [rating] = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(await lowRatingEvents(rating?.['id'] as string)).toHaveLength(1);
  });

  it('writes no event when the rating itself cannot be stored', async () => {
    const { owner } = context.harness;
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');
    const before = await allLowRatingEvents();
    await owner`ALTER TABLE ratings ADD CONSTRAINT zz_low_rating_store_fails CHECK (stars > 100) NOT VALID`;
    try {
      expect((await submitRequest(context.harness, link.token, { stars: 1 })).status).toBe(500);
    } finally {
      await owner`ALTER TABLE ratings DROP CONSTRAINT zz_low_rating_store_fails`;
    }
    expect(await allLowRatingEvents()).toBe(before);
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).toBeNull();
  });
});
