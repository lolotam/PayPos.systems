import { safeDisplayName, t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { serviceLineCancelNoticeRequested } from '@pospay/contracts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { LineCancelNameFallback } from '../domain/line-cancel-notice.ts';
import { onLineCancelled } from '../events/handlers/on-line-cancelled.handler.ts';
import { alertRules } from '../persistence/alert-rule.adapter.ts';
import { lineCancelPlace } from '../persistence/line-cancel-place.adapter.ts';
import { lineCancelRecipients } from '../persistence/line-cancel-recipients.adapter.ts';
import {
  lineCancelOutbox,
  lineCancelRepository,
} from '../persistence/service-line-cancel-notice.repository.ts';
import { RequestLineCancelNotice } from '../use-cases/request-line-cancel-notice/request-line-cancel-notice.ts';
import { lineCancelFixture, type LineCancelFixture } from './line-cancel-notice.fixture.ts';

let f: LineCancelFixture;
beforeAll(async () => {
  f = await lineCancelFixture();
});
afterAll(async () => {
  await f?.close();
});

it('a redelivered event keeps one ledger row and one notice', async () => {
  const prepared = await f.cancel();
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  await f.owner`DELETE FROM consumed_events WHERE company_id=${prepared.companyId} AND consumer_id=${f.consumer.id} AND event_id=${prepared.event.id}`;
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([
    { recipient_count: 1, revision: 2, source_event_id: prepared.event.id },
  ]);
  const requests = await f.requests(prepared.sessionId);
  expect(requests).toHaveLength(1);
  const parsed = serviceLineCancelNoticeRequested.parse(requests[0]?.['payload']);
  expect(parsed.business_timezone).toBe('Asia/Kuwait');
  expect(parsed.notification_recipients.map((recipient) => recipient.user_id)).toEqual([USER]);
  expect(parsed.notification_recipients[0]).toMatchObject({
    channel: 'IN_APP',
    locale: 'ar',
    template_key: 'service_line_cancelled',
    template_revision: 1,
  });
  expect(parsed.notification_recipients[0]?.safe_parameters.map((item) => item.name)).toEqual([
    'service_name_ar',
    'service_name_en',
    'branch_name_ar',
    'branch_name_en',
    'business_date',
    'cancelled_net',
  ]);
  expect(JSON.stringify(parsed)).not.toContain('customer left unhappy');
  expect(JSON.stringify(parsed)).not.toContain('Canceller Identity');
});

it('two concurrent deliveries of one cancel write one ledger row and one notice', async () => {
  const prepared = await f.cancel();
  const second = await f.anotherEvent(prepared);
  expect(await Promise.all([f.deliver(prepared.event), f.deliver(second)])).toEqual([
    { delivered: true },
    { delivered: true },
  ]);
  expect(await f.notices(prepared.lineId)).toHaveLength(1);
  expect(await f.requests(prepared.sessionId)).toHaveLength(1);
});

it('two lines of one visit ring twice', async () => {
  const first = await f.cancel({ ordinal: 1 });
  const second = await f.cancel({ sessionId: first.sessionId, ordinal: 2 });
  expect(await f.deliver(first.event)).toEqual({ delivered: true });
  expect(await f.deliver(second.event)).toEqual({ delivered: true });
  expect(await f.notices(first.lineId)).toHaveLength(1);
  expect(await f.notices(second.lineId)).toHaveLength(1);
  expect(await f.requests(first.sessionId)).toHaveLength(2);
});

it('no manager in scope records a ledger row with count 0 and no notice', async () => {
  const prepared = await f.cancel();
  expect(await withoutManagers()(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.requests(prepared.sessionId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(1);
});

function withoutManagers() {
  return createDeliverer(
    f.db,
    [
      {
        ...f.consumer,
        handle: (tx, event) =>
          onLineCancelled(
            new RequestLineCancelNotice(
              {
                recipients: {
                  ...lineCancelRecipients(tx),
                  branchManagerRecipients: async () => [],
                },
                place: lineCancelPlace(tx),
                repository: lineCancelRepository(tx),
                outbox: lineCancelOutbox(tx),
                rules: alertRules(tx),
              },
              f.ids,
              { now: () => f.at },
              catalogFallback(),
            ),
            event,
          ),
      },
    ],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
}
function catalogFallback(): LineCancelNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    safeName: safeDisplayName,
  };
}
