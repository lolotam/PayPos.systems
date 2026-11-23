import { lowRatingReceived } from '@pospay/contracts';
import { createDatabase, SYSTEM_ROLES, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { RATING_TENANT } from '../../../../../packages/db/test/rating-fixtures.ts';
import { USER } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { createDeliverer } from '../../../../worker/src/outbox/deliver.ts';
import { createLowRatingNoticeConsumer } from '../../../../worker/src/modules/customers/index.ts';
import { createInAppNotificationModule } from '../../../../worker/src/modules/notifications/index.ts';
import {
  BEFORE_EXPIRY,
  linkWithPerformers,
  startRatingContext,
  submitRequest,
  type RatingContext,
} from '../../modules/customers/__tests__/rating-submission.fixture.ts';

const tenant = RATING_TENANT.A;
const COMMENT = 'الخدمة اتأخرت كتير';
const roleId = (code: string): string => SYSTEM_ROLES.find((role) => role.code === code)?.id ?? '';
const ids = systemUuidV7();
let context: RatingContext;
let db: Database;
let holder: string;
const at = new Date();

/** مالك الشركة ومدير فرع، بعضوية بدأت قبل لحظة المستهلك، عشان الاثنين مستلمين مؤهلين. */
async function seedManagers(): Promise<string> {
  const { owner } = context.harness;
  const starts = new Date(at.getTime() - 60_000);
  const addMember = async (userId: string, role: string, scope: string, scopeId: string) =>
    owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
      VALUES(${tenant.company},${ids.newId()},${userId},${roleId(role)},'global',${scope},${scopeId},${starts})`;
  const manager = ids.newId();
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES
    (${USER},'Synthetic owner','owner@example.test',true,now(),now()),
    (${manager},'Synthetic manager',${`${manager}@example.test`},true,now(),now())
    ON CONFLICT DO NOTHING`;
  await addMember(USER, 'owner', 'COMPANY', tenant.company);
  await addMember(manager, 'branch_manager', 'BRANCH', tenant.branch);
  return manager;
}

beforeAll(async () => {
  context = await startRatingContext();
  db = createDatabase({ url: context.harness.urls.app, ids, maxConnections: 4 });
  holder = await seedManagers();
});
afterAll(async () => {
  await db?.close();
  await context.harness.close();
});

/** الحدث كما يطلّعه الـ dispatcher من صف الأوتبوكس المحفوظ، مش حمولة مكتوبة باليد. */
async function storedEvents(ratingId: string, eventType: string): Promise<ClaimedEvent[]> {
  const rows = await context.harness.owner`SELECT id, company_id, aggregate_type, aggregate_id,
      event_type, payload FROM outbox
    WHERE company_id=${tenant.company} AND aggregate_id=${ratingId} AND event_type=${eventType}
    ORDER BY seq`;
  return rows.map((row) => ({
    id: row['id'] as string,
    companyId: row['company_id'] as string,
    aggregateType: row['aggregate_type'] as string,
    aggregateId: row['aggregate_id'] as string,
    eventType: row['event_type'] as string,
    payload: row['payload'],
    attempt: 1,
  }));
}

it('SC-004: a 2-star submit reaches the stored bell through both outbox hops', async () => {
  context.setNow(BEFORE_EXPIRY);
  const link = await linkWithPerformers(context.harness, 'A', tenant.employees);
  const submitted = await submitRequest(context.harness, link.token, {
    stars: 2,
    comment: COMMENT,
  });
  expect(submitted.status).toBe(204);
  const [rating] = await context.harness.owner`SELECT id FROM ratings
    WHERE company_id=${tenant.company} AND request_id=${link.requestId}`;
  const ratingId = rating?.['id'] as string;

  const logger = createLogger('silent');
  const noticeConsumer = createLowRatingNoticeConsumer(ids, { now: () => at });
  const bellModule = createInAppNotificationModule({ database: db, ids, clock: { now: () => at } });
  const hopOne = createDeliverer(db, [noticeConsumer], logger, {
    knownEventTypes: noticeConsumer.eventTypes,
  });
  const hopTwo = createDeliverer(db, [bellModule.consumer], logger, {
    knownEventTypes: bellModule.eventTypes,
  });

  const [submittedEvent, ...extra] = await storedEvents(ratingId, 'LowRatingSubmitted');
  expect(extra).toHaveLength(0);
  if (submittedEvent === undefined) throw new Error('THE_API_WROTE_NO_EVENT');
  expect(await hopOne(submittedEvent)).toEqual({ delivered: true });

  const received = await storedEvents(ratingId, 'LowRatingReceived');
  expect(received).toHaveLength(1);
  const [notice] = received;
  if (notice === undefined) throw new Error('THE_WORKER_WROTE_NO_NOTICE');
  const recipients = lowRatingReceived.parse(notice.payload).notification_recipients;
  expect(recipients.map((recipient) => recipient.template_key)).toEqual([
    'low_rating_with_comment',
    'low_rating_with_comment',
  ]);
  expect(await hopTwo(notice)).toEqual({ delivered: true });

  const rows = await context.harness.owner`SELECT recipient_user_id, template_key, business_id,
      branch_id, safe_parameters FROM in_app_notifications
    WHERE company_id=${tenant.company} AND source_event_id=${notice.id} ORDER BY recipient_user_id`;
  expect(rows.map((row) => row['recipient_user_id'])).toEqual([USER, holder].sort());
  for (const row of rows) {
    expect(row['template_key']).toBe('low_rating_with_comment');
    expect(row['business_id']).toBe(tenant.business);
    expect(row['branch_id']).toBe(tenant.branch);
    expect(row['safe_parameters']).toEqual([
      {
        name: 'details',
        type: 'details',
        value: expect.objectContaining({
          stars: 2,
          comment: COMMENT,
          phone_last3: expect.any(String),
        }),
      },
    ]);
  }
});
