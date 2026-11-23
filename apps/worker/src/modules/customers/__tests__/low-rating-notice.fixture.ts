import postgres from 'postgres';
import {
  appendOutboxEvent,
  createDatabase,
  SYSTEM_ROLES,
  type ClaimedEvent,
  type Database,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  claimRequest,
  consumeAndRate,
  insertRequest,
  RATING_TENANT,
  seedRatingTenants,
} from '../../../../../../packages/db/test/rating-fixtures.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { createLowRatingNoticeConsumer } from '../index.ts';

const A = RATING_TENANT.A;
const RATED_AT = '2026-06-02T00:00:00Z';
const roleId = (code: string): string => SYSTEM_ROLES.find((role) => role.code === code)?.id ?? '';

export interface StoredRatingRow {
  readonly ratingId: string;
  readonly requestId: string;
  readonly stars: number;
}

type Owner = postgres.Sql;
type Ids = ReturnType<typeof systemUuidV7>;

/** مالك الشركة ومدير فرع بصلاحية قراءة التعليق وآخر عليه DENY، وهاتف العميل بأرقام معروفة. */
async function seedManagers(owner: Owner, ids: Ids, at: Date) {
  const starts = new Date(at.getTime() - 60_000);
  const addUser = async (): Promise<string> => {
    const id = ids.newId();
    await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
      VALUES(${id},'Synthetic manager',${`${id}@example.test`},true,now(),now())`;
    return id;
  };
  const addMember = async (userId: string, role: string, scope: string, scopeId: string) => {
    const id = ids.newId();
    await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
      VALUES(${A.company},${id},${userId},${roleId(role)},'global',${scope},${scopeId},${starts})`;
    return id;
  };
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${USER},'Synthetic owner','owner@example.test',true,now(),now()) ON CONFLICT DO NOTHING`;
  await addMember(USER, 'owner', 'COMPANY', A.company);
  const holder = await addUser();
  await addMember(holder, 'branch_manager', 'BRANCH', A.branch);
  const denied = await addUser();
  const deniedMembership = await addMember(denied, 'branch_manager', 'BRANCH', A.branch);
  await owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${A.company},${ids.newId()},${deniedMembership},'read:ratings:branch','DENY','BRANCH',${A.branch},
      'Synthetic test override',${USER})`;
  await owner`UPDATE customers SET phone='+12025550123'
    WHERE company_id=${A.company} AND id=${A.customer}`;
  return { owner: USER, holder, denied };
}

/** تقييم محفوظ كما يكتبه الرابط العام: طلب مطالَب به ثم استهلاك وتقييم ونسب لمنفذين اثنين. */
function ratingFactory(db: Database, ids: Ids) {
  let day = 0;
  return async (stars: number, comment: string | null = null): Promise<StoredRatingRow> => {
    day += 1;
    const tokenHash = Buffer.alloc(32, day);
    const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
    return db.withTenant(A.company, async (tx) => {
      const requestId = await insertRequest(tx, { tenant: A, date });
      const claim = { tenant: A, requestId, tokenHash, now: RATED_AT };
      await claimRequest(tx, { ...claim, readyEventId: ids.newId(), performers: A.employees });
      const ratingId = await consumeAndRate(tx, {
        ...claim,
        stars,
        comment,
        attribute: A.employees,
      });
      if (ratingId === null) throw new Error('fixture rating required');
      return { ratingId, requestId, stars };
    });
  };
}

/** الحدث الذي سيلحقه API في 61-1i داخل معاملة التقييم، بعد تثبيته كصف أوتبوكس حقيقي. */
function eventFactory(db: Database, ids: Ids) {
  return async (
    row: StoredRatingRow,
    override: Partial<Record<'stars' | 'branch_id', unknown>> = {},
  ): Promise<ClaimedEvent> => {
    const payload = {
      schema_version: 1,
      rating_id: row.ratingId,
      request_id: row.requestId,
      business_id: A.business,
      branch_id: A.branch,
      stars: row.stars,
      ...override,
    };
    const id = ids.newId();
    const claimed = {
      companyId: A.company,
      id,
      aggregateType: 'rating',
      aggregateId: row.ratingId,
      eventType: 'LowRatingSubmitted',
      payload,
      attempt: 1,
    };
    await db.withTenant(A.company, (tx) =>
      appendOutboxEvent(tx, id, {
        aggregateType: claimed.aggregateType,
        aggregateId: claimed.aggregateId,
        eventType: claimed.eventType,
        payload,
      }),
    );
    return claimed;
  };
}

/** قاعدة اختبار معزولة بشركتين وتقييمات ومديرين جاهزين للمستهلك. */
export async function lowRatingFixture() {
  const testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const ids = systemUuidV7();
  const at = new Date();
  const db: Database = createDatabase({ url: testDb.appUrl, ids, maxConnections: 6 });
  const consumer = createLowRatingNoticeConsumer(ids, { now: () => at });
  const deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  const users = await seedManagers(owner, ids, at);
  return {
    testDb,
    owner,
    db,
    ids,
    at,
    consumer,
    deliver,
    tenant: A,
    otherTenant: TENANT.B,
    users,
    rating: ratingFactory(db, ids),
    event: eventFactory(db, ids),
    notices: (ratingId: string) =>
      owner`SELECT * FROM low_rating_notices WHERE company_id=${A.company} AND rating_id=${ratingId}`,
    received: (ratingId: string) =>
      owner`SELECT * FROM outbox WHERE company_id=${A.company} AND aggregate_id=${ratingId} AND event_type='LowRatingReceived' ORDER BY seq`,
    consume: (input: ClaimedEvent) =>
      db.withTenant(input.companyId, (tx) => consumer.handle(tx, input)),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type LowRatingFixture = Awaited<ReturnType<typeof lowRatingFixture>>;
