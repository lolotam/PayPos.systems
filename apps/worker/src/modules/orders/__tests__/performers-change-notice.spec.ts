import { safeDisplayName, t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { serviceLinePerformersNoticeRequested } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { PerformersChangeNameFallback } from '../domain/performers-change-notice.ts';
import { onPerformersChanged } from '../events/handlers/on-performers-changed.handler.ts';
import { alertRules } from '../persistence/alert-rule.adapter.ts';
import { performersChangePlace } from '../persistence/performers-change-place.adapter.ts';
import { performersChangeRecipients } from '../persistence/performers-change-recipients.adapter.ts';
import {
  performersChangeOutbox,
  performersChangeRepository,
} from '../persistence/service-line-performer-notice.repository.ts';
import { RequestPerformersChangeNotice } from '../use-cases/request-performers-change-notice/request-performers-change-notice.ts';
import {
  PERFORMER_NAME,
  PERFORMERS_CHANGER,
  PERFORMERS_REASON,
} from './performers-change-data.ts';
import {
  performersChangeFixture,
  type PerformersChangeFixture,
} from './performers-change-notice.fixture.ts';

let f: PerformersChangeFixture;
beforeAll(async () => {
  f = await performersChangeFixture();
});
afterAll(async () => {
  await f?.close();
});

it('a redelivered event keeps one ledger row and one notice', async () => {
  const prepared = await f.change();
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  await f.owner`DELETE FROM consumed_events WHERE company_id=${prepared.companyId} AND consumer_id=${f.consumer.id} AND event_id=${prepared.event.id}`;
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([
    { recipient_count: 1, revision: 2, source_event_id: prepared.event.id },
  ]);
  const requests = await f.requests(prepared.lineId);
  expect(requests).toHaveLength(1);
  const parsed = serviceLinePerformersNoticeRequested.parse(requests[0]?.['payload']);
  expect(parsed.business_timezone).toBe('Asia/Kuwait');
  expect(parsed.notification_recipients.map((recipient) => recipient.user_id)).toEqual([USER]);
  expect(parsed.notification_recipients[0]).toMatchObject({
    channel: 'IN_APP',
    locale: 'ar',
    template_key: 'service_line_performers_changed',
    template_revision: 1,
  });
  expect(parsed.notification_recipients[0]?.safe_parameters.map((item) => item.name)).toEqual([
    'service_name_ar',
    'service_name_en',
    'branch_name_ar',
    'branch_name_en',
    'business_date',
    'line_net',
  ]);
  const body = JSON.stringify(parsed);
  expect(body).not.toContain(PERFORMERS_REASON);
  expect(body).not.toContain(PERFORMERS_CHANGER);
  expect(body).not.toContain(PERFORMER_NAME);
});

it('a second change of the same line rings again', async () => {
  const first = await f.change();
  expect(await f.deliver(first.event)).toEqual({ delivered: true });
  const second = await f.change({ line: first, again: true });
  expect(await f.deliver(second.event)).toEqual({ delivered: true });
  expect(await f.notices(first.lineId)).toMatchObject([{ revision: 2 }, { revision: 3 }]);
  expect(await f.requests(first.lineId)).toHaveLength(2);
});

it('still accepts the event after a later change raised the line revision', async () => {
  const first = await f.change();
  await f.change({ line: first, again: true });
  const firstSides = await sides(first.lineId, 2);
  const laterSides = await sides(first.lineId, 3);
  expect(column(firstSides, 'BEFORE', 'employee_id')).not.toEqual(column(firstSides, 'AFTER', 'employee_id'));
  expect(column(firstSides, 'BEFORE', 'share_bps')).not.toEqual(column(firstSides, 'AFTER', 'share_bps'));
  expect(column(firstSides, 'AFTER', 'employee_id')).not.toEqual(column(laterSides, 'AFTER', 'employee_id'));
  expect(column(firstSides, 'AFTER', 'share_bps')).not.toEqual(column(laterSides, 'AFTER', 'share_bps'));
  expect(await f.deliver(first.event)).toEqual({ delivered: true });
  expect(await f.notices(first.lineId)).toMatchObject([{ revision: 2, recipient_count: 1 }]);
  expect(await f.requests(first.lineId)).toHaveLength(1);
});

it('rejects an event whose performers are swapped against the stored history', async () => {
  const prepared = await f.change();
  await expect(f.consume(swapped(prepared.event))).rejects.toThrow('LINE_PERFORMERS_EVENT_INVALID');
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
});

it('still requests the bell once after a later price edit', async () => {
  const prepared = await f.change({ follow: 'price' });
  expect(await f.owner`SELECT revision, status, price::text AS price FROM service_lines
    WHERE company_id=${prepared.companyId} AND id=${prepared.lineId}`).toMatchObject([
    { revision: 3, status: 'ACTIVE', price: '2.000' },
  ]);
  expect(await f.owner`SELECT revision FROM service_line_edits
    WHERE company_id=${prepared.companyId} AND line_id=${prepared.lineId}`).toMatchObject([{ revision: 3 }]);
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([{ revision: 2, recipient_count: 1 }]);
  expect(await f.requests(prepared.lineId)).toHaveLength(1);
});

it('still requests the bell once after a later cancellation', async () => {
  const prepared = await f.change({ follow: 'cancel' });
  expect(await f.owner`SELECT revision, status FROM service_lines
    WHERE company_id=${prepared.companyId} AND id=${prepared.lineId}`).toMatchObject([
    { revision: 3, status: 'CANCELLED' },
  ]);
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([{ revision: 2, recipient_count: 1 }]);
  expect(await f.requests(prepared.lineId)).toHaveLength(1);
});

it('no manager in scope records a ledger row with count 0 and no notice', async () => {
  const prepared = await f.change();
  expect(await withoutManagers()(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.requests(prepared.lineId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(1);
});

function swapped(event: ClaimedEvent): ClaimedEvent {
  const payload = structuredClone(event.payload) as {
    performers: { employee_id: string; share_bps: number }[];
    change: { previous: { performers: { employee_id: string; share_bps: number }[] } };
  };
  const current = payload.performers;
  payload.performers = payload.change.previous.performers;
  payload.change.previous.performers = current;
  return { ...event, payload };
}
async function sides(lineId: string, revision: number) {
  return f.owner<{ side: string; employee_id: string; share_bps: string }[]>`SELECT r.side, r.employee_id, r.share_bps::text
    FROM service_line_performer_change_rows r
    JOIN service_line_performer_changes c
      ON c.company_id=r.company_id AND c.business_id=r.business_id AND c.id=r.change_id
    WHERE c.company_id=${f.tenant.company} AND c.line_id=${lineId} AND c.revision=${revision}
    ORDER BY r.side, r.performer_ordinal`;
}
function column(
  rows: readonly { side: string; employee_id: string; share_bps: string }[],
  side: string,
  key: 'employee_id' | 'share_bps',
) {
  return rows.filter((row) => row.side === side).map((row) => row[key]);
}
function withoutManagers() {
  return createDeliverer(
    f.db,
    [
      {
        ...f.consumer,
        handle: (tx, event) =>
          onPerformersChanged(
            new RequestPerformersChangeNotice(
              {
                recipients: {
                  ...performersChangeRecipients(tx),
                  branchManagerRecipients: async () => [],
                },
                place: performersChangePlace(tx),
                repository: performersChangeRepository(tx),
                outbox: performersChangeOutbox(tx),
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
function catalogFallback(): PerformersChangeNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    safeName: safeDisplayName,
  };
}
