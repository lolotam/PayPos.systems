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

/** The five ways a link stops being the link the customer holds. */
const TAMPERED = [
  {
    label: 'an altered random character',
    tamper: (token: string) => {
      const parts = token.split('.');
      const secret = parts[1] ?? '';
      return `${parts[0] ?? ''}.${secret.startsWith('A') ? 'B' : 'A'}${secret.slice(1)}`;
    },
  },
  {
    label: 'an altered prefix',
    tamper: (token: string) => `${RATING_TENANT.B.company}.${token.split('.')[1] ?? ''}`,
  },
  { label: 'an upper-case token', tamper: (token: string) => token.toUpperCase() },
  { label: 'a truncated token', tamper: (token: string) => token.slice(0, -1) },
  { label: 'a token with an extra part', tamper: (token: string) => `${token}.extra` },
];

describe('a tampered rating link', () => {
  it.each(TAMPERED)('refuses $label for the view and the submit', async ({ tamper }) => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');
    const token = tamper(link.token);

    const viewed = await viewRequest(context.harness, token);
    expect(viewed.status).toBe(404);
    expect(viewed.body['code']).toBe('RATING_LINK_UNAVAILABLE');
    // الرد ما بيقولش أي اسم نشاط: الرد الموحّد هو كل اللي بره ياخده.
    expect(viewed.body['business_name']).toBeUndefined();
    expect(viewed.text).not.toContain('Business A');

    const submitted = await submitRequest(context.harness, token);
    expect(submitted.status).toBe(404);
    expect(submitted.body['code']).toBe('RATING_LINK_UNAVAILABLE');
    const ratings = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(ratings).toHaveLength(0);
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).toBeNull();
  });
});

describe('replaying a rating link', () => {
  it('stores one rating for two sequential submits', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');

    const first = await submitRequest(context.harness, link.token);
    const second = await submitRequest(context.harness, link.token);

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
    expect(second.body['code']).toBe('RATING_LINK_UNAVAILABLE');
    const ratings = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(ratings).toHaveLength(1);
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).not.toBeNull();
  });

  it('stores one rating for two concurrent submits', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');

    const responses = await Promise.all([
      submitRequest(context.harness, link.token),
      submitRequest(context.harness, link.token),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([204, 404]);
    const ratings = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(ratings).toHaveLength(1);
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).not.toBeNull();
  });

  it('never consumes the link when the page is only viewed', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');

    const before = await viewRequest(context.harness, link.token);
    expect(before.status).toBe(200);
    expect(before.body['state']).toBe('open');
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).toBeNull();

    expect((await submitRequest(context.harness, link.token)).status).toBe(204);
    const consumed = await consumedAt(context.harness, link.companyId, link.requestId);

    const after = await viewRequest(context.harness, link.token);
    expect(after.status).toBe(200);
    expect(after.body['state']).toBe('submitted');
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).toEqual(consumed);
  });
});
