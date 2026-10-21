import type { ClaimedEvent, Tx } from '@pospay/db';
import { safeDisplayName, t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { failingBranchRead } from './failing-branch-read.ts';
import type { PerformersChangeNameFallback } from '../domain/performers-change-notice.ts';
import { onPerformersChanged } from '../events/handlers/on-performers-changed.handler.ts';
import { performersChangeRecipients } from '../persistence/performers-change-recipients.adapter.ts';
import {
  performersChangeOutbox,
  performersChangeRepository,
} from '../persistence/service-line-performer-notice.repository.ts';
import { RequestPerformersChangeNotice } from '../use-cases/request-performers-change-notice/request-performers-change-notice.ts';
import { createLineCancelNoticeConsumer, createPriceEditNoticeConsumer } from '../index.ts';
import {
  performersChangeFixture,
  type PerformersChangeFixture,
} from './performers-change-notice.fixture.ts';
import type { PreparedChange } from './performers-change-data.ts';

let f: PerformersChangeFixture;
beforeAll(async () => {
  f = await performersChangeFixture();
});
afterAll(async () => {
  await f?.close();
});

it('a price edit, a cancellation, or no change block is consumed with no ledger row', async () => {
  const price = await f.change({ kind: 'price' });
  const cancelled = await f.change({ kind: 'cancel' });
  const absent = await f.change({ kind: 'absent' });
  for (const prepared of [price, cancelled, absent]) {
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.lineId)).toHaveLength(0);
    expect(await f.requests(prepared.lineId)).toHaveLength(0);
    expect(await f.consumed(prepared.event.id)).toHaveLength(1);
  }
});

it('the price-edit and cancel consumers ignore a performers change', async () => {
  const prepared = await f.change();
  for (const consumer of [
    createPriceEditNoticeConsumer(f.ids, { now: () => f.at }),
    createLineCancelNoticeConsumer(f.ids, { now: () => f.at }),
  ]) {
    const deliver = createDeliverer(f.db, [consumer], createLogger('silent'), {
      knownEventTypes: consumer.eventTypes,
    });
    expect(await deliver(prepared.event)).toEqual({ delivered: true });
    expect(await consumedBy(consumer.id, prepared)).toHaveLength(1);
  }
  expect(await editNotices(prepared)).toHaveLength(0);
  expect(await cancelNotices(prepared)).toHaveLength(0);
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
});

it('a closed company skips a matching performers change', async () => {
  const prepared = await f.change();
  await f.owner`UPDATE companies SET deleted_at=${f.at} WHERE id=${prepared.companyId}`;
  try {
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.lineId)).toHaveLength(0);
    expect(await f.consumed(prepared.event.id)).toHaveLength(1);
  } finally {
    await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${prepared.companyId}`;
  }
});

it('a bad header, side, date, branch or aggregate writes nothing', async () => {
  await expectInvalid(await f.change({ missingHeader: true }));
  await expectInvalid(await f.change({ mismatch: 'after-employee' }));
  await expectInvalid(await f.change({ mismatch: 'before-employee' }));
  await expectInvalid(await f.change({ branchId: f.ids.newId() }));
  await expectInvalid(await f.change({ kind: 'malformed' }));
  const badDate = await f.change();
  const other = badDate.businessDate === '2026-01-15' ? '2026-01-16' : '2026-01-15';
  (badDate.event.payload as { business_date: string }).business_date = other;
  await expectInvalid(badDate);
  const typed = await f.change();
  await expectInvalid(typed, { ...typed.event, aggregateType: 'service_line' });
  const foreign = await f.change();
  await expectInvalid(foreign, { ...foreign.event, aggregateId: f.ids.newId() });
});

it('a missing branch place is recorded with no recipients and is not retried', async () => {
  const prepared = await f.change();
  const deliver = createDeliverer(
    f.db,
    [{ ...f.consumer, handle: (tx, event) => onPerformersChanged(useCase(tx), event) }],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  expect(await deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.requests(prepared.lineId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(1);
  expect(await f.deliver({ ...prepared.event, id: f.ids.newId() })).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toHaveLength(1);
  expect(await f.requests(prepared.lineId)).toHaveLength(0);
});

it('a transient failure reading the branch place rolls back and is retried', async () => {
  const prepared = await f.change();
  const flaky = createDeliverer(failingBranchRead(f.db), [f.consumer], createLogger('silent'), {
    knownEventTypes: f.consumer.eventTypes,
  });
  expect(await flaky(prepared.event)).toMatchObject({
    delivered: false,
    retryInMs: expect.any(Number),
  });
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(0);
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 1 }]);
  expect(await f.requests(prepared.lineId)).toHaveLength(1);
});

async function expectInvalid(prepared: PreparedChange, event: ClaimedEvent = prepared.event) {
  expect((await f.deliver(event)).delivered).toBe(false);
  await expect(f.consume(event)).rejects.toThrow('LINE_PERFORMERS_EVENT_INVALID');
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
  expect(
    await f.owner`SELECT event_id FROM consumed_events WHERE company_id=${event.companyId} AND consumer_id=${f.consumer.id} AND event_id=${event.id}`,
  ).toHaveLength(0);
}
function useCase(tx: Tx) {
  return new RequestPerformersChangeNotice(
    {
      recipients: performersChangeRecipients(tx),
      place: { branchPlace: async () => null },
      repository: performersChangeRepository(tx),
      outbox: performersChangeOutbox(tx),
    },
    f.ids,
    { now: () => f.at },
    catalogFallback(),
  );
}
function catalogFallback(): PerformersChangeNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    safeName: safeDisplayName,
  };
}
function consumedBy(consumerId: string, prepared: PreparedChange) {
  return f.owner`SELECT event_id FROM consumed_events WHERE company_id=${prepared.companyId} AND consumer_id=${consumerId} AND event_id=${prepared.event.id}`;
}
function editNotices(prepared: PreparedChange) {
  return f.owner`SELECT id FROM service_line_edit_notices WHERE company_id=${prepared.companyId} AND line_id=${prepared.lineId}`;
}
function cancelNotices(prepared: PreparedChange) {
  return f.owner`SELECT id FROM service_line_cancel_notices WHERE company_id=${prepared.companyId} AND line_id=${prepared.lineId}`;
}
