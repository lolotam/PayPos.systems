// مُنشئ الاختبار: نفس قواعد بيانات 59-1 مع المطالبة نفسها، عشان الحالة تطلع من المصدر الحقيقي.
import postgres from 'postgres';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { createTestDatabase } from '../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { seedOrders } from '../../../../../packages/db/test/orders-fixture.ts';
import { createDeliverer } from '../../outbox/deliver.ts';
import { daySessionsReader } from '../../modules/orders/index.ts';
import { createRatingSchedulingConsumer } from '../../modules/customers/index.ts';
import { branchScheduleHoursAdapter } from '../../modules/customers/persistence/branch-schedule-hours.adapter.ts';
import { businessNames } from '../../modules/customers/persistence/business-names.adapter.ts';
import { performerNameAdapter } from '../../modules/customers/persistence/performer-name.adapter.ts';
import { ratingClaimRepository } from '../../modules/customers/persistence/rating-claim.repository.ts';
import { ratingClaimTransactions } from '../../modules/customers/persistence/rating-claim.transactions.ts';
import { ratingOutbox } from '../../modules/customers/persistence/rating-outbox.adapter.ts';
import { ratingTokenPort } from '../../modules/customers/persistence/rating-token.adapter.ts';
import type { RatingRequestsSwitchPort } from '../../modules/customers/ports/rating-requests-switch.port.ts';
import { ClaimRatingRequest } from '../../modules/customers/use-cases/claim-rating-request/claim-rating-request.ts';
import { ClaimRatingRequests } from '../../modules/customers/use-cases/claim-rating-requests/claim-rating-requests.ts';
import { schedulingData } from '../../rating-scheduling/__tests__/rating-scheduling-data.ts';

export { everyDay } from '../../rating-scheduling/__tests__/rating-scheduling-data.ts';
export type { BranchOptions, SessionOptions } from '../../rating-scheduling/__tests__/rating-scheduling-data.ts';

/** المفتاح اللي بيتقفل عليه الطلب: النشاط والعميل ويوم الطلب. */
export interface SwitchFake extends RatingRequestsSwitchPort {
  on: boolean;
}

/** اشتقاق البصمة في الاختبار: إصدار مفتاح بيتبدّل من غير ما يغيّر البصمة نفسها. */
export interface TokenFake {
  version: number;
  hash: Uint8Array;
}

export async function ratingClaimsFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  await seedOrders(owner);
  const ids = systemUuidV7();
  let employeeSequence = 1;
  const db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 6 });
  const clock = {
    at: new Date('2026-06-01T00:00:00.000Z'),
    now(): Date {
      return this.at;
    },
  };
  const enabled: SwitchFake = {
    on: true,
    enabled: async () => enabled.on,
  };
  const scheduling = createRatingSchedulingConsumer({
    ids,
    clock,
    daySessions: daySessionsReader,
    ratingSwitch: enabled,
  });
  const deliver = createDeliverer(db, [scheduling], createLogger('silent'), {
    knownEventTypes: scheduling.eventTypes,
  });
  const token: TokenFake = { version: 1, hash: new Uint8Array(32).fill(7) };
  const claim = new ClaimRatingRequest(
    {
      switch: enabled,
      hours: branchScheduleHoursAdapter,
      names: businessNames,
      daySessions: daySessionsReader,
      performers: performerNameAdapter,
      claims: ratingClaimRepository,
      token: ratingTokenPort({ claim: () => ({ tokenHash: token.hash, keyVersion: token.version }) }),
      outbox: ratingOutbox,
    },
    ids,
    clock,
  );
  const pass = new ClaimRatingRequests(ratingClaimTransactions(db), claim, clock);
  const data = schedulingData({ owner, db, ids });
  return {
    testDb,
    owner,
    db,
    ids,
    clock,
    enabled,
    token,
    company: TENANT.A.company,
    tenant: TENANT.A,
    branch: data.branch,
    customer: data.customer,
    session: data.session,
    cancelLine: data.cancelLine,
    otherBusiness: data.otherBusiness,
    /**جدولة الطلب من حدث الزيارة، زي ما بيعمل العامل في الإنتاج. */
    schedule: async (sessionId: string) =>
      deliver(await data.event(sessionId, 'ServiceSessionRecorded')),
    /** جولة مطالبة واحدة للشركة. */
    claimAll: async () => pass.execute(TENANT.A.company),
    /** صف الطلب بكل أعمدة المطالبة. */
    request: async (customerId: string) => {
      const rows = await owner`SELECT id, status, cancel_reason, branch_id, due_at, send_deadline,
          token_hash, token_key_version, claimed_at, expires_at, ready_event_id
        FROM rating_requests WHERE company_id = ${TENANT.A.company} AND customer_id = ${customerId}`;
      return rows[0];
    },
    /** أحداث الجاهزية المنشورة للشركة. */
    readyEvents: async () =>
      owner`SELECT id, event_type, payload FROM outbox
        WHERE company_id = ${TENANT.A.company} AND event_type = 'RatingRequestReady'
        ORDER BY created_at, id`,
    /** لقطة منفذي الطلب. */
    performers: async (requestId: string) =>
      owner`SELECT employee_id FROM rating_performers
        WHERE company_id = ${TENANT.A.company} AND request_id = ${requestId}
        ORDER BY employee_id`,
    /** إيقاف العميل من صفحة التقييم. */
    optOut: async (customerId: string) => {
      await owner`UPDATE customers SET opted_out_at = now(), updated_at = now()
        WHERE company_id = ${TENANT.A.company} AND id = ${customerId}`;
    },
    /** موظف ثاني في النشاط، عشان الإسناد يبقى مفهوم في الاختبار. */
    secondEmployee: async () => {
      employeeSequence += 1;
      const employeeId = ids.newId();
      await owner`INSERT INTO employees
          (company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
        VALUES(${TENANT.A.company},${employeeId},${TENANT.A.business},${TENANT.A.branch},
          ${`Performer ${employeeSequence}`},${`performer ${employeeSequence}`},'staff','2026-01-01',${employeeSequence + 1})`;
      return employeeId;
    },
    /** تغيير منفّذ البند، عشان الإسناد يتغيّر قبل المطالبة. */
    setPerformer: async (lineId: string, employeeId: string) => {
      await owner`UPDATE line_performers SET employee_id = ${employeeId}
        WHERE company_id = ${TENANT.A.company} AND line_id = ${lineId}`;
    },
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type RatingClaimsFixture = Awaited<ReturnType<typeof ratingClaimsFixture>>;
