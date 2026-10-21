import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const { A } = TENANT;
const HASH = 'a'.repeat(64);

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const as = (company: string, query: ReturnType<typeof sql>) =>
  db.withTenant(company, (tx) => tx.execute(query), { userId: USER });

function pgError(error: unknown): { code?: string; constraint_name?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (candidate.code !== undefined || candidate.constraint_name !== undefined) return candidate;
    current = candidate.cause;
  }
  return {};
}

async function refused(work: Promise<unknown>, code: string, constraint?: string | string[]) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect(pgError(error).code).toBe(code);
  if (constraint === undefined) return;
  const expected = Array.isArray(constraint) ? constraint : [constraint];
  expect(expected).toContain(pgError(error).constraint_name);
}

// غائب يعني "القيمة الافتراضية" وصريح null يعني SQL NULL.
function value<T>(given: T | undefined, fallback: T): T {
  return given === undefined ? fallback : given;
}

type ProposalOptions = {
  id: string;
  kind?: 'RECORD' | 'EDIT' | undefined;
  lineId?: string | null | undefined;
  baseRevision?: number | null | undefined;
  basePrice?: string | null | undefined;
  baseDiscount?: string | null | undefined;
  baseNet?: string | null | undefined;
  inputIndex?: number | undefined;
  sessionId?: string | null | undefined;
  limitSource?: string | undefined;
  limitBps?: number | null | undefined;
};

const insertProposal = (options: ProposalOptions) =>
  sql`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,line_id,base_revision,
    base_price,base_discount,base_net,session_id,occurred_at,customer_id,service_id,service_name_en,terms,terms_hash,effective_bps,
    requested_by,requested_by_membership_id,requester_limit_source,requester_limit_bps,requester_role,requester_role_is_system,
    requester_role_name_en,customer_first_name,requested_at,status,expires_at)
  VALUES(${A.company},${options.id},${A.business},${A.branch},${ids.newId()},${value(options.inputIndex, 0)},
    ${value(options.kind, 'RECORD')},${value(options.lineId, null)},${value(options.baseRevision, null)},
    ${value(options.basePrice, null)},${value(options.baseDiscount, null)},${value(options.baseNet, null)},
    ${value(options.sessionId, ORDER_IDS.session)},clock_timestamp(),${ORDER_IDS.customer},${ORDER_IDS.service},'Synthetic service',
    '{}'::jsonb,${HASH},2000,${USER},${ORDER_IDS.membership},${value(options.limitSource, 'PERSON')},
    ${value(options.limitBps, 1000)},'cashier',true,'Cashier','Synthetic',clock_timestamp(),'PENDING',
    clock_timestamp() + interval '1 day')`;

const editProposal = (id: string, patch: { baseNet?: string | null; inputIndex?: number } = {}) =>
  insertProposal({
    id,
    kind: 'EDIT',
    lineId: ORDER_IDS.line,
    baseRevision: 2,
    basePrice: '25.000',
    baseDiscount: '5.000',
    baseNet: patch.baseNet === undefined ? '20.000' : patch.baseNet,
    inputIndex: patch.inputIndex,
  });

const decide = (id: string, status: 'APPROVED' | 'REJECTED', extra = sql``) =>
  sql`UPDATE discount_proposals SET status=${status},decided_by=${USER},decided_by_membership_id=${ORDER_IDS.membership},
    decided_via='REMOTE',decider_role='owner',decider_role_is_system=true,decider_role_name_en='Owner',
    decided_at=clock_timestamp() ${extra} WHERE id=${id}`;

// بنقارن النص مش اللحظة: فرق المنطقة الزمنية بين قراءتين ما يخلّيش المقارنة غلط.
const expiryOf = async (id: string) => {
  const [row] = await as(
    A.company,
    sql`SELECT expires_at::text AS expires_at FROM discount_proposals WHERE id=${id}`,
  );
  return row?.expires_at;
};

const consume = (id: string, extra = sql``) =>
  sql`UPDATE discount_proposals SET status='CONSUMED',consumed_line_id=${ORDER_IDS.line},
    consumed_at=clock_timestamp() ${extra} WHERE id=${id}`;

it('refuses a requester limit whose bps is missing', async () => {
  await refused(
    as(A.company, insertProposal({ id: ids.newId(), limitSource: 'PERSON', limitBps: null })),
    '23514',
    'dp_requester_limit_ck',
  );
});

it('refuses an approval whose limit has a bps but no source', async () => {
  const id = ids.newId();
  await as(A.company, insertProposal({ id }));
  await refused(
    as(
      A.company,
      decide(id, 'APPROVED', sql`,approver_is_performer=false,approved_limit_bps=2000`),
    ),
    '23514',
    'dp_approved_limit_ck',
  );
});

it('refuses a record proposal that names a line', async () => {
  await refused(
    as(A.company, insertProposal({ id: ids.newId(), lineId: ORDER_IDS.line })),
    '23514',
    'dp_kind_shape_ck',
  );
});

it('accepts a record proposal with no base amounts', async () => {
  const id = ids.newId();
  await as(A.company, insertProposal({ id }));
  const rows = await as(
    A.company,
    sql`SELECT kind,base_price,base_discount,base_net FROM discount_proposals WHERE id=${id}`,
  );
  expect(rows).toEqual([{ kind: 'RECORD', base_price: null, base_discount: null, base_net: null }]);
});

it('refuses an edit proposal without its base net', async () => {
  // The per-kind rule and the amount rule both reject the row, so either name is the refusal.
  await refused(as(A.company, editProposal(ids.newId(), { baseNet: null })), '23514', [
    'dp_kind_shape_ck',
    'dp_base_amounts_ck',
  ]);
});

it('refuses an edit proposal whose net contradicts its price and discount', async () => {
  await refused(
    as(A.company, editProposal(ids.newId(), { baseNet: '999.000' })),
    '23514',
    'dp_base_amounts_ck',
  );
});

it('refuses an edit proposal that is not the first line of its request', async () => {
  await refused(
    as(A.company, editProposal(ids.newId(), { inputIndex: 1 })),
    '23514',
    'dp_kind_shape_ck',
  );
});

it('refuses an approval without the performer flag', async () => {
  const id = ids.newId();
  await as(A.company, insertProposal({ id }));
  await refused(
    as(A.company, decide(id, 'APPROVED', sql`,approved_limit_source='OWNER'`)),
    '23514',
    'dp_approver_flag_ck',
  );
});

it('accepts an edit proposal that names its line and its base amounts', async () => {
  const id = ids.newId();
  await as(A.company, editProposal(id));
  const rows = await as(
    A.company,
    sql`SELECT kind,line_id,base_revision FROM discount_proposals WHERE id=${id}`,
  );
  expect(rows).toEqual([{ kind: 'EDIT', line_id: ORDER_IDS.line, base_revision: 2 }]);
});

it('refuses to change the kind or the base amounts of a pending proposal', async () => {
  const id = ids.newId();
  await as(A.company, insertProposal({ id }));
  await refused(
    owner`UPDATE discount_proposals SET kind='EDIT' WHERE company_id=${A.company} AND id=${id}`,
    '23514',
    'discount_proposals_transition_guard',
  );
  await refused(
    owner`UPDATE discount_proposals SET base_price='30.000' WHERE company_id=${A.company} AND id=${id}`,
    '23514',
    'discount_proposals_transition_guard',
  );
});

it('refuses a reject that moves the expiry and accepts one that keeps it', async () => {
  const id = ids.newId();
  await as(A.company, insertProposal({ id }));
  await refused(
    as(A.company, decide(id, 'REJECTED', sql`,expires_at=clock_timestamp() + interval '48 hours'`)),
    '23514',
    'discount_proposals_transition_guard',
  );
  await as(A.company, decide(id, 'REJECTED'));
  const rows = await as(A.company, sql`SELECT status FROM discount_proposals WHERE id=${id}`);
  expect(rows).toEqual([{ status: 'REJECTED' }]);
});

it('accepts an approval that flags the performer and keeps the expiry', async () => {
  const id = ids.newId();
  await as(A.company, insertProposal({ id }));
  const requested = await expiryOf(id);
  await as(
    A.company,
    decide(id, 'APPROVED', sql`,approved_limit_source='OWNER',approver_is_performer=true`),
  );
  const rows = await as(
    A.company,
    sql`SELECT status,approver_is_performer FROM discount_proposals WHERE id=${id}`,
  );
  expect(rows).toEqual([{ status: 'APPROVED', approver_is_performer: true }]);
  expect(await expiryOf(id)).toBe(requested);
});

it('refuses an approval that moves the expiry', async () => {
  const id = ids.newId();
  await as(A.company, insertProposal({ id }));
  const requested = await expiryOf(id);
  await refused(
    as(
      A.company,
      decide(
        id,
        'APPROVED',
        sql`,approved_limit_source='OWNER',approver_is_performer=true,expires_at=clock_timestamp() + interval '24 hours'`,
      ),
    ),
    '23514',
    'discount_proposals_transition_guard',
  );
  const rows = await as(A.company, sql`SELECT status FROM discount_proposals WHERE id=${id}`);
  expect(rows).toEqual([{ status: 'PENDING' }]);
  expect(await expiryOf(id)).toBe(requested);
});

it('refuses a consumption that moves the expiry', async () => {
  const id = ids.newId();
  await as(A.company, insertProposal({ id }));
  await as(
    A.company,
    decide(id, 'APPROVED', sql`,approved_limit_source='OWNER',approver_is_performer=false`),
  );
  await refused(
    as(A.company, consume(id, sql`,expires_at=clock_timestamp() + interval '24 hours'`)),
    '23514',
    'discount_proposals_transition_guard',
  );
  const rows = await as(A.company, sql`SELECT status FROM discount_proposals WHERE id=${id}`);
  expect(rows).toEqual([{ status: 'APPROVED' }]);
});
