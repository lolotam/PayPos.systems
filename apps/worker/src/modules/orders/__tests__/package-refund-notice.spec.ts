import { packageRefundNoticeRequested } from '@pospay/contracts';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { onPackageRefundRecorded } from '../events/handlers/on-package-refund-recorded.handler.ts';
import {
  packageRefundOutbox,
  packageRefundRepository,
} from '../persistence/package-refund-notice.repository.ts';
import { lineCancelPlace } from '../persistence/line-cancel-place.adapter.ts';
import { lineCancelRecipients } from '../persistence/line-cancel-recipients.adapter.ts';
import { RequestPackageRefundNotice } from '../use-cases/request-package-refund-notice/request-package-refund-notice.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import {
  REFUND_REASON,
  REFUNDER_USER,
  packageRefundNoticeFixture,
  type PackageRefundNoticeFixture,
} from './package-refund-notice.fixture.ts';

const OWNER_USER = '01920000-0000-7000-8000-0000000000f1';

let f: PackageRefundNoticeFixture;

beforeAll(async () => {
  f = await packageRefundNoticeFixture();
});

afterAll(async () => {
  await f?.close();
});

it('one delivered event writes one ledger row and one notice with the seven safe parameters', async () => {
  const seeded = await f.refund();
  expect(await f.deliver(seeded.event)).toEqual({ delivered: true });
  const notices = await f.notices(seeded.refund);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({ recipient_count: 2, source_event_id: seeded.event.id });
  const requests = await f.requests(seeded.entitlement);
  expect(requests).toHaveLength(1);
  const parsed = packageRefundNoticeRequested.parse(requests[0]?.['payload']);
  expect(parsed.business_timezone).toBe('Asia/Kuwait');
  expect(parsed.notification_recipients.map((recipient) => recipient.user_id).sort()).toEqual([
    OWNER_USER,
    REFUNDER_USER,
  ]);
  expect(parsed.notification_recipients[0]).toMatchObject({
    channel: 'IN_APP',
    locale: 'ar',
    template_key: 'package_refund_recorded',
    template_revision: 1,
  });
  expect(parsed.notification_recipients[0]?.safe_parameters.map((item) => item.name)).toEqual([
    'package_name_ar',
    'package_name_en',
    'branch_name_ar',
    'branch_name_en',
    'sessions',
    'amount',
    'business_date',
  ]);
  expect(JSON.stringify(parsed)).not.toContain(REFUND_REASON);
  expect(JSON.stringify(parsed)).not.toMatch(/phone|customer/i);
});

it('the refunder is not excluded from the bell', async () => {
  const seeded = await f.refund();
  expect(await f.deliver(seeded.event)).toEqual({ delivered: true });
  const requests = await f.requests(seeded.entitlement);
  const parsed = packageRefundNoticeRequested.parse(requests[0]?.['payload']);
  expect(parsed.notification_recipients.map((recipient) => recipient.user_id)).toContain(
    REFUNDER_USER,
  );
});

it('a redelivered event keeps one ledger row and one notice', async () => {
  const seeded = await f.refund();
  expect(await f.deliver(seeded.event)).toEqual({ delivered: true });
  await f.owner`DELETE FROM consumed_events WHERE company_id=${f.companyId}
    AND consumer_id='orders.package-refund-notice-v1' AND event_id=${seeded.event.id}`;
  expect(await f.deliver(seeded.event)).toEqual({ delivered: true });
  expect(await f.notices(seeded.refund)).toHaveLength(1);
  expect(await f.requests(seeded.entitlement)).toHaveLength(1);
});

it('no manager in scope records a durable ledger row with count 0 and no notice', async () => {
  const seeded = await f.refund();
  const deliver = createDeliverer(
    f.db,
    [
      {
        ...f.consumer,
        handle: (tx, event) =>
          onPackageRefundRecorded(
            new RequestPackageRefundNotice(
              {
                recipients: {
                  ...lineCancelRecipients(tx),
                  branchManagerRecipients: async () => [],
                },
                place: lineCancelPlace(tx),
                repository: packageRefundRepository(tx),
                outbox: packageRefundOutbox(tx),
              },
              f.ids,
              { now: () => f.at },
              {
                packageName: { ar: 'Package', en: 'Package' },
                branch: { ar: 'Branch', en: 'Branch' },
                safeName: (value) => value,
              },
            ),
            event,
          ),
      },
    ],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  expect(await deliver(seeded.event)).toEqual({ delivered: true });
  expect(await f.notices(seeded.refund)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.requests(seeded.entitlement)).toHaveLength(0);
});

it('uses an explicit branch timezone override when set instead of the business timezone', async () => {
  await f.owner`UPDATE branches SET timezone='Asia/Riyadh' WHERE id=${f.branchId}`;
  try {
    const seeded = await f.refund();
    expect(await f.deliver(seeded.event)).toEqual({ delivered: true });
    const requests = await f.requests(seeded.entitlement);
    expect(packageRefundNoticeRequested.parse(requests[0]?.['payload']).business_timezone).toBe(
      'Asia/Riyadh',
    );
  } finally {
    await f.owner`UPDATE branches SET timezone=NULL WHERE id=${f.branchId}`;
  }
});
