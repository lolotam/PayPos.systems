import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  claimRequest,
  consumeAndRate,
  insertRequest,
  RATING_TENANT,
  seedRatingTenants,
} from '../../test/rating-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A } = RATING_TENANT;
const NOW = '2026-06-02T00:00:00Z';
const EXPECTED_INDEXES = [
  'rating_attributions_branch_idx',
  'rating_attributions_employee_idx',
  'rating_attributions_performer_idx',
  'rating_attributions_pkey',
  'rating_attributions_rating_employee_key',
  'rating_performers_employee_idx',
  'rating_performers_pkey',
  'rating_performers_request_employee_key',
  'rating_requests_branch_id_key',
  'rating_requests_branch_idx',
  'rating_requests_business_id_key',
  'rating_requests_customer_idx',
  'rating_requests_day_key',
  'rating_requests_due_idx',
  'rating_requests_pkey',
  'rating_requests_ready_event_key',
  'rating_requests_token_hash_key',
  'ratings_attribution_key',
  'ratings_branch_idx',
  'ratings_pkey',
  'ratings_request_fk_idx',
  'ratings_request_key',
].sort();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner.begin(async (tx) => {
    for (let position = 0; position < 100; position += 1) {
      await insertRequest(tx, {
        tenant: A,
        date: new Date(Date.UTC(2027, 0, position + 1)).toISOString().slice(0, 10),
        dueAt: new Date(Date.UTC(2026, 5, 1, position)),
        status: position < 50 ? 'SCHEDULED' : 'CANCELLED',
        cancelReason: position < 50 ? null : 'PAST_DEADLINE',
      });
    }
  });
  const tokenHash = Buffer.alloc(32, 231);
  const requestId = await owner<{ id: string }[]>`SELECT id FROM rating_requests
    WHERE company_id=${A.company} AND status='SCHEDULED' ORDER BY due_at,id LIMIT 1`;
  await db.withTenant(A.company, async (tx) => {
    const id = requestId[0]?.id as string;
    await claimRequest(tx, {
      tenant: A,
      requestId: id,
      tokenHash,
      readyEventId: ids.newId(),
      now: NOW,
      performers: [A.employees[0]],
    });
    await consumeAndRate(tx, {
      tenant: A,
      requestId: id,
      tokenHash,
      now: NOW,
      stars: 5,
      attribute: [A.employees[0]],
    });
  });
  await owner`ANALYZE rating_requests, rating_attributions`;
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const EXPLAIN_ROLLBACK = 'the explain transaction rolls the dropped indexes back';

async function explain(statement: string, parameters: unknown[]): Promise<string> {
  let plan = '';
  try {
    await owner.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`;
      // كل الفهارس بتبدأ بـ company_id، فالمخطط كان بيختار فهرس تاني؛ بنسقط الباقي جوه الـ transaction والـ rollback يرجّعه.
      await tx`DROP INDEX rating_attributions_branch_idx`;
      await tx`DROP INDEX rating_attributions_performer_idx`;
      const rows = await tx.unsafe(
        `EXPLAIN ${statement}`,
        parameters as postgres.ParameterOrJSON<never>[],
      );
      plan = JSON.stringify(rows);
      throw new Error(EXPLAIN_ROLLBACK);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== EXPLAIN_ROLLBACK) throw error;
  }
  return plan;
}

it('the claim page uses rating_requests_due_idx', async () => {
  const plan = await explain(
    `SELECT id FROM rating_requests WHERE company_id=$1 AND status='SCHEDULED'
      AND due_at<=$2 ORDER BY due_at,id LIMIT 100`,
    [A.company, NOW],
  );
  expect(plan).toContain('rating_requests_due_idx');
});

it('the token lookup uses rating_requests_token_hash_key', async () => {
  const plan = await explain(
    'SELECT id FROM rating_requests WHERE company_id=$1 AND token_hash=$2',
    [A.company, Buffer.alloc(32, 231)],
  );
  expect(plan).toContain('rating_requests_token_hash_key');
});

it('the staff average lookup uses rating_attributions_employee_idx', async () => {
  const plan = await explain(
    `SELECT stars FROM rating_attributions
      WHERE company_id=$1 AND employee_id=$2 AND submitted_at>=$3`,
    [A.company, A.employees[0], '2026-01-01T00:00:00Z'],
  );
  expect(plan).toContain('rating_attributions_employee_idx');
});

it('every named index exists and the three partial predicates are exact', async () => {
  const rows = await owner<{ indexname: string; indexdef: string }[]>`
    SELECT indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' AND indexname=ANY(${EXPECTED_INDEXES}) ORDER BY indexname`;
  expect(rows.map((row) => row.indexname)).toEqual(EXPECTED_INDEXES);
  const definitions = new Map(rows.map((row) => [row.indexname, row.indexdef]));
  expect(definitions.get('rating_requests_due_idx')).toMatch(
    /WHERE \(status = 'SCHEDULED'::text\)/,
  );
  expect(definitions.get('rating_requests_ready_event_key')).toContain(
    'WHERE (ready_event_id IS NOT NULL)',
  );
  expect(definitions.get('rating_requests_token_hash_key')).toContain(
    'WHERE (token_hash IS NOT NULL)',
  );
});
