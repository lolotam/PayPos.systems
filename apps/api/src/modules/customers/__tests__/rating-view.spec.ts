import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RATING_TENANT } from '../../../../../../packages/db/test/rating-fixtures.ts';
import {
  BEFORE_EXPIRY,
  consumedAt,
  linkFor,
  ratingsForRequest,
  startRatingContext,
  submitRequest,
  viewRequest,
  type RatingContext,
} from './rating-submission.fixture.ts';

let context: RatingContext;

beforeAll(async () => {
  context = await startRatingContext();
});
afterAll(async () => {
  await context.harness.close();
});

/** حرف برا الـ BMP: وحده بالـ code points، مش بوحدات UTF-16. */
const OUTSIDE_BMP = '😀';

describe('the expiry of a rating link', () => {
  it('serves and accepts the rating one millisecond before the expiry', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');
    context.setNow(new Date(link.expiresAt.getTime() - 1));

    const viewed = await viewRequest(context.harness, link.token);
    const submitted = await submitRequest(context.harness, link.token);

    expect(viewed.status).toBe(200);
    expect(viewed.body['state']).toBe('open');
    expect(submitted.status).toBe(204);
  });

  it('refuses the rating exactly at the expiry', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');
    context.setNow(link.expiresAt);

    const viewed = await viewRequest(context.harness, link.token);
    const submitted = await submitRequest(context.harness, link.token);

    expect(viewed.status).toBe(404);
    expect(viewed.body['code']).toBe('RATING_LINK_UNAVAILABLE');
    expect(submitted.status).toBe(404);
    const ratings = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(ratings).toHaveLength(0);
  });

  it('refuses the rating after the expiry', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');
    context.setNow(new Date(link.expiresAt.getTime() + 1));

    const viewed = await viewRequest(context.harness, link.token);
    const submitted = await submitRequest(context.harness, link.token);

    expect(viewed.status).toBe(404);
    expect(submitted.status).toBe(404);
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).toBeNull();
  });
});

describe('the note of the customer', () => {
  it('accepts a rating without a note', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');

    const response = await submitRequest(context.harness, link.token, { stars: 5 });

    expect(response.status).toBe(204);
    const ratings = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(ratings[0]?.['comment']).toBeNull();
  });

  it('stores an empty note as no note', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');

    const response = await submitRequest(context.harness, link.token, { stars: 5, comment: '' });

    expect(response.status).toBe(204);
    const ratings = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(ratings[0]?.['comment']).toBeNull();
  });

  it('accepts a note of a thousand characters outside the BMP', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');

    const response = await submitRequest(context.harness, link.token, {
      stars: 5,
      comment: OUTSIDE_BMP.repeat(1_000),
    });

    expect(response.status).toBe(204);
    const ratings = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(ratings).toHaveLength(1);
  });

  it.each([
    { label: 'a note of a thousand and one characters', comment: OUTSIDE_BMP.repeat(1_001) },
    { label: 'a note with a link', comment: 'شوف https://example.com' },
    { label: 'a note with a www prefix', comment: 'www.example.com' },
    { label: 'a note with a bare domain', comment: 'example.com' },
  ])('refuses $label and leaves the link open', async ({ comment }) => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');

    const refused = await submitRequest(context.harness, link.token, { stars: 5, comment });

    expect(refused.status).toBe(400);
    expect(refused.body['code']).toBe('RATING_INPUT_INVALID');
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).toBeNull();
    expect((await submitRequest(context.harness, link.token, { stars: 5 })).status).toBe(204);
  });
});

describe('the rating page', () => {
  it('answers with the business name and the state, and nothing else', async () => {
    context.setNow(BEFORE_EXPIRY);
    await context.harness.owner`UPDATE businesses SET name_ar='صالون النخيل'
      WHERE company_id=${RATING_TENANT.A.company} AND id=${RATING_TENANT.A.business}`;
    const link = await linkFor(context.harness, 'A');

    const response = await viewRequest(context.harness, link.token);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['business_name', 'state']);
    expect(response.body['business_name']).toBe('صالون النخيل');
    expect(response.body['state']).toBe('open');
  });

  it('shows the English name to a customer whose locale is English', async () => {
    context.setNow(BEFORE_EXPIRY);
    await context.harness.owner`UPDATE businesses SET name_ar='صالون النخيل'
      WHERE company_id=${RATING_TENANT.A.company} AND id=${RATING_TENANT.A.business}`;
    const link = await linkFor(context.harness, 'A');
    await context.harness.owner`UPDATE customers SET locale='en'
      WHERE company_id=${link.companyId} AND id=${link.customer}`;

    const response = await viewRequest(context.harness, link.token);

    expect(response.status).toBe(200);
    expect(response.body['business_name']).toBe('Business A');
  });
});
