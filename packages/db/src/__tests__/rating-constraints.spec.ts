import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  expectPgError,
  type InsertRequestOptions,
  insertRequest,
  OTHER_RATING_BUSINESS,
  RATING_TENANT,
  seedRatingTenants,
} from '../../test/rating-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
const ids = systemUuidV7();
const { A, B } = RATING_TENANT;
const NOW = '2026-06-02T00:00:00Z';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner?.end();
  await testDb?.drop();
});

// replica بيعطّل التريغر والمفاتيح الأجنبية بس، فالـ CHECK والفهارس الفريدة تفضل شغالة.
function withoutGuards(work: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<unknown> {
  return owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = 'replica'`;
    return work(tx);
  });
}

function refuseRequest(options: Partial<InsertRequestOptions>, constraint: string): Promise<void> {
  return expectPgError(
    withoutGuards((tx) => insertRequest(tx, { tenant: A, ...options })),
    '23514',
    constraint,
  );
}

function claimedValues(
  tokenHash: Buffer,
  readyEventId = ids.newId(),
): Partial<InsertRequestOptions> {
  return {
    status: 'SENDING',
    tokenHash,
    readyEventId,
    claimXactId: '1',
    claimedAt: '2026-06-01T00:00:00Z',
    expiresAt: '2026-06-08T00:00:00Z',
  };
}

it('accepts a complete valid claimed, sent and consumed row', async () => {
  const id = ids.newId();
  await withoutGuards((tx) =>
    insertRequest(tx, {
      tenant: A,
      id,
      ...claimedValues(Buffer.alloc(32, 1)),
      status: 'SENT',
      sentAt: NOW,
      consumedAt: NOW,
      consumeXactId: '2',
    }),
  );
  const rows = await owner`SELECT status FROM rating_requests WHERE id=${id}`;
  expect(rows).toEqual([{ status: 'SENT' }]);
});

it('accepts a cancelled request because the activity turned rating requests off', async () => {
  const id = ids.newId();
  await withoutGuards((tx) =>
    insertRequest(tx, {
      tenant: A,
      id,
      status: 'CANCELLED',
      cancelReason: 'REQUESTS_OFF',
    }),
  );
  const rows = await owner`SELECT cancel_reason FROM rating_requests WHERE id=${id}`;
  expect(rows).toEqual([{ cancel_reason: 'REQUESTS_OFF' }]);
});

it.each([
  { options: { status: 'VOID' }, constraint: 'rating_requests_status' },
  {
    options: { status: 'CANCELLED', cancelReason: 'SWITCHED_OFF' },
    constraint: 'rating_requests_cancel_reason',
  },
  {
    options: { cancelReason: 'NO_ACTIVE_LINE' },
    constraint: 'rating_requests_cancel_pair',
  },
  {
    options: { ...claimedValues(Buffer.alloc(32, 2)), readyEventId: null },
    constraint: 'rating_requests_token_group',
  },
  { options: { status: 'SENDING' }, constraint: 'rating_requests_token_status' },
  {
    options: { ...claimedValues(Buffer.alloc(32, 3)), sentAt: null, status: 'SENT' },
    constraint: 'rating_requests_sent_pair',
  },
  { options: { consumedAt: NOW }, constraint: 'rating_requests_consumed_token' },
  {
    options: { ...claimedValues(Buffer.alloc(32, 4)), consumedAt: NOW },
    constraint: 'rating_requests_proofs',
  },
])('refuses $constraint', async ({ options, constraint }) => {
  await refuseRequest(options, constraint);
});

it.each([31, 33])('refuses a %s-byte token hash', async (length) => {
  await refuseRequest(claimedValues(Buffer.alloc(length, 5)), 'rating_requests_token_hash_len');
});

it('refuses key version zero and an expiry other than 168 hours', async () => {
  await refuseRequest(
    { ...claimedValues(Buffer.alloc(32, 6)), tokenKeyVersion: 0 },
    'rating_requests_key_version',
  );
  await refuseRequest(
    { ...claimedValues(Buffer.alloc(32, 7)), expiresAt: '2026-06-09T00:00:00Z' },
    'rating_requests_expiry',
  );
});

it('refuses consumption at or after expiry and missing transaction proofs', async () => {
  await refuseRequest(
    {
      ...claimedValues(Buffer.alloc(32, 8)),
      consumedAt: '2026-06-08T00:00:00Z',
      consumeXactId: '2',
    },
    'rating_requests_consumed_window',
  );
  await refuseRequest(
    {
      ...claimedValues(Buffer.alloc(32, 14)),
      consumedAt: '2026-06-08T00:00:00.001Z',
      consumeXactId: '2',
    },
    'rating_requests_consumed_window',
  );
  await refuseRequest(
    { ...claimedValues(Buffer.alloc(32, 9)), consumeXactId: '2' },
    'rating_requests_proofs',
  );
  await refuseRequest(
    { ...claimedValues(Buffer.alloc(32, 10)), claimXactId: null },
    'rating_requests_proofs',
  );
});

it('allows one request per customer, business and day only', async () => {
  await insertRequest(owner, { tenant: A, date: '2026-07-01' });
  await expectPgError(
    insertRequest(owner, { tenant: A, date: '2026-07-01' }),
    '23505',
    'rating_requests_day_key',
  );
  await insertRequest(owner, { tenant: A, date: '2026-07-02' });
  await insertRequest(owner, {
    tenant: A,
    business: OTHER_RATING_BUSINESS.business,
    branch: OTHER_RATING_BUSINESS.branch,
    date: '2026-07-01',
  });
});

it('scopes partial ready-event uniqueness to the tenant', async () => {
  const readyEventId = ids.newId();
  await withoutGuards((tx) =>
    insertRequest(tx, {
      tenant: A,
      date: '2026-07-03',
      ...claimedValues(Buffer.alloc(32, 11), readyEventId),
    }),
  );
  await expectPgError(
    withoutGuards((tx) =>
      insertRequest(tx, {
        tenant: A,
        date: '2026-07-04',
        ...claimedValues(Buffer.alloc(32, 12), readyEventId),
      }),
    ),
    '23505',
    'rating_requests_ready_event_key',
  );
  await withoutGuards((tx) =>
    insertRequest(tx, {
      tenant: B,
      date: '2026-07-07',
      ...claimedValues(Buffer.alloc(32, 11), readyEventId),
    }),
  );
});

it('scopes partial token-hash uniqueness to the tenant', async () => {
  const tokenHash = Buffer.alloc(32, 13);
  await withoutGuards((tx) =>
    insertRequest(tx, { tenant: A, date: '2026-07-05', ...claimedValues(tokenHash) }),
  );
  await expectPgError(
    withoutGuards((tx) =>
      insertRequest(tx, { tenant: A, date: '2026-07-06', ...claimedValues(tokenHash) }),
    ),
    '23505',
    'rating_requests_token_hash_key',
  );
  await withoutGuards((tx) =>
    insertRequest(tx, { tenant: B, date: '2026-07-08', ...claimedValues(tokenHash) }),
  );
});

it('refuses a branch of another business and a customer of another tenant', async () => {
  await expectPgError(
    insertRequest(owner, { tenant: A, date: '2026-08-01', branch: OTHER_RATING_BUSINESS.branch }),
    '23503',
    'rating_requests_branch_fk',
  );
  await expectPgError(
    insertRequest(owner, { tenant: A, date: '2026-08-02', customer: B.customer }),
    '23503',
    'rating_requests_customer_fk',
  );
  await expectPgError(
    insertRequest(owner, { tenant: A, date: '2026-08-03', business: B.business }),
    '23503',
    'rating_requests_business_fk',
  );
});
