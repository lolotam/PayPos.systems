import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RATING_TENANT } from '../../../../../../packages/db/test/rating-fixtures.ts';
import type { Harness } from '../../../../test/harness.ts';
import {
  attributedEmployees,
  BEFORE_EXPIRY,
  consumedAt,
  linkFor,
  linkWithPerformers,
  ratingsForRequest,
  startRatingContext,
  submitRequest,
  viewRequest,
  type RatingContext,
} from './rating-submission.fixture.ts';

const THIRD_EMPLOYEE = '01920000-0000-7000-8000-000000000aa4';

/** A third employee in the same business, outside the rating's performer snapshot. */
async function seedEmployee(harness: Harness, employeeId: string, employeeNumber: number) {
  const name = `Synthetic employee ${employeeNumber}`;
  await harness.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${RATING_TENANT.A.company},${employeeId},${RATING_TENANT.A.business},${RATING_TENANT.A.branch},
      ${name},${name.toLowerCase()},'staff','2026-01-01',${employeeNumber})`;
}

let context: RatingContext;

beforeAll(async () => {
  context = await startRatingContext();
});
afterAll(async () => {
  await context.harness.close();
});

describe('a rating link of another tenant', () => {
  it('refuses the foreign prefix without writing in either tenant', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkFor(context.harness, 'A');
    const foreign = `${RATING_TENANT.B.company}.${link.token.split('.')[1] ?? ''}`;

    const viewed = await viewRequest(context.harness, foreign);
    const submitted = await submitRequest(context.harness, foreign);

    expect(viewed.status).toBe(404);
    expect(submitted.status).toBe(404);
    const ratings = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(ratings).toHaveLength(0);
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).toBeNull();
    const foreignRatings = await context.harness.owner`SELECT count(*)::int AS total FROM ratings
      WHERE company_id=${RATING_TENANT.B.company}`;
    expect(foreignRatings[0]?.['total']).toBe(0);
  });
});

describe('the attribution of a rating', () => {
  it('gives only the snapshotted performers one attribution row', async () => {
    context.setNow(BEFORE_EXPIRY);
    await seedEmployee(context.harness, THIRD_EMPLOYEE, 41);
    const snapshotted = RATING_TENANT.A.employees.slice(0, 1);
    const link = await linkWithPerformers(context.harness, 'A', snapshotted);

    const response = await submitRequest(context.harness, link.token, { stars: 4 });

    expect(response.status).toBe(204);
    expect(await attributedEmployees(context.harness, link.companyId, link.requestId)).toEqual(
      snapshotted,
    );
    const all = await context.harness.owner`SELECT employee_id FROM rating_attributions
      WHERE company_id=${link.companyId} ORDER BY employee_id`;
    expect(all.map((row) => row['employee_id'])).toEqual(snapshotted);
  });

  it('stores the stars and the note of the customer', async () => {
    context.setNow(BEFORE_EXPIRY);
    const link = await linkWithPerformers(context.harness, 'A', RATING_TENANT.A.employees);

    const response = await submitRequest(context.harness, link.token, {
      stars: 5,
      comment: 'خدمة كويسة',
    });

    expect(response.status).toBe(204);
    const ratings = await ratingsForRequest(context.harness, link.companyId, link.requestId);
    expect(ratings).toHaveLength(1);
    expect(ratings[0]?.['stars']).toBe(5);
    expect(ratings[0]?.['comment']).toBe('خدمة كويسة');
  });

  it('refuses performer ids in the body and leaves the link open', async () => {
    context.setNow(BEFORE_EXPIRY);
    const performers = RATING_TENANT.A.employees;
    const link = await linkWithPerformers(context.harness, 'A', performers);

    const refused = await submitRequest(context.harness, link.token, {
      stars: 5,
      employee_ids: [...performers],
    });

    expect(refused.status).toBe(422);
    expect(refused.body['code']).toBe('RATING_INPUT_INVALID');
    expect(await consumedAt(context.harness, link.companyId, link.requestId)).toBeNull();
    expect((await submitRequest(context.harness, link.token, { stars: 5 })).status).toBe(204);
  });
});
