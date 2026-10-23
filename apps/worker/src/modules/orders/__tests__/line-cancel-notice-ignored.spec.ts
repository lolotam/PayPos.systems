import type { ClaimedEvent, Tx } from '@pospay/db';
import { safeDisplayName, t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { failingBranchRead } from './failing-branch-read.ts';
import type { LineCancelNameFallback } from '../domain/line-cancel-notice.ts';
import { onLineCancelled } from '../events/handlers/on-line-cancelled.handler.ts';
import { alertRules } from '../persistence/alert-rule.adapter.ts';
import { lineCancelRecipients } from '../persistence/line-cancel-recipients.adapter.ts';
import {
  lineCancelOutbox,
  lineCancelRepository,
} from '../persistence/service-line-cancel-notice.repository.ts';
import { RequestLineCancelNotice } from '../use-cases/request-line-cancel-notice/request-line-cancel-notice.ts';
import { createPriceEditNoticeConsumer } from '../index.ts';
import { lineCancelFixture, type LineCancelFixture } from './line-cancel-notice.fixture.ts';
import type { PreparedCancel } from './line-cancel-data.ts';

let f: LineCancelFixture;
beforeAll(async () => {
  f = await lineCancelFixture();
});
afterAll(async () => {
  await f?.close();
});

it('a price edit, a performers change, or no change block is consumed with no ledger row', async () => {
  const absent = await f.cancel({ change: 'absent' });
  const price = await f.cancel({ change: 'price' });
  const performers = await f.cancel({ change: 'performers' });
  expect(await f.deliver(absent.event)).toEqual({ delivered: true });
  expect(await f.deliver(price.event)).toEqual({ delivered: true });
  expect(await f.deliver(performers.event)).toEqual({ delivered: true });
  for (const prepared of [absent, price, performers]) {
    expect(await f.notices(prepared.lineId)).toHaveLength(0);
    expect(await f.requests(prepared.sessionId)).toHaveLength(0);
    expect(await f.consumed(prepared.event.id)).toHaveLength(1);
  }
});

it('the price-edit consumer still ignores LINE_CANCELLED', async () => {
  const prepared = await f.cancel();
  const priceEdit = createPriceEditNoticeConsumer(f.ids, { now: () => f.at });
  const deliver = createDeliverer(f.db, [priceEdit], createLogger('silent'), {
    knownEventTypes: priceEdit.eventTypes,
  });
  expect(await deliver(prepared.event)).toEqual({ delivered: true });
  expect(
    await f.owner`SELECT id FROM service_line_edit_notices WHERE company_id=${prepared.companyId} AND line_id=${prepared.lineId}`,
  ).toHaveLength(0);
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
  expect(
    await f.owner`SELECT event_id FROM consumed_events WHERE company_id=${prepared.companyId} AND consumer_id=${priceEdit.id} AND event_id=${prepared.event.id}`,
  ).toHaveLength(1);
});

it('a closed company skips a matching cancel', async () => {
  const prepared = await f.cancel();
  await f.owner`UPDATE companies SET deleted_at=${f.at} WHERE id=${prepared.companyId}`;
  try {
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.lineId)).toHaveLength(0);
    expect(await f.consumed(prepared.event.id)).toHaveLength(1);
  } finally {
    await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${prepared.companyId}`;
  }
});

it('revision or net that disagrees with the history row writes nothing', async () => {
  await expectInvalid(await f.cancel({ change: 'malformed' }));
  const foreign = await f.cancel();
  await expectInvalid(foreign, { ...foreign.event, companyId: TENANT.B.company });
  await expectInvalid(await f.cancel({ branchId: f.ids.newId() }));
  await expectInvalid(await f.cancel({ eventRevision: 3 }));
  await expectInvalid(await f.cancel({ cancel: false }));
  await expectInvalid(await f.cancel({ eventNet: '2.000', eventPreviousNet: '2.000' }));
  await expectInvalid(await f.cancel({ eventPreviousNet: '2.000' }));
  const badDate = await f.cancel();
  (badDate.event.payload as { business_date: string }).business_date = '2026-02-30';
  await expectInvalid(badDate);
});

it('a business date that disagrees with the session writes nothing', async () => {
  const prepared = await f.cancel();
  const other = prepared.businessDate === '2026-01-15' ? '2026-01-16' : '2026-01-15';
  (prepared.event.payload as { business_date: string }).business_date = other;
  expect((await f.deliver(prepared.event)).delivered).toBe(false);
  await expect(f.consume(prepared.event)).rejects.toThrow('LINE_CANCEL_EVENT_INVALID');
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
  expect(await f.requests(prepared.sessionId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(0);
});

it('a missing branch place is recorded with no recipients and is not retried', async () => {
  const prepared = await f.cancel();
  const deliver = createDeliverer(
    f.db,
    [{ ...f.consumer, handle: (tx, event) => onLineCancelled(useCase(tx), event) }],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  expect(await deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.requests(prepared.sessionId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(1);
  expect(await f.deliver({ ...prepared.event, id: f.ids.newId() })).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toHaveLength(1);
  expect(await f.requests(prepared.sessionId)).toHaveLength(0);
});

it('a transient failure reading the branch place rolls back and is retried', async () => {
  const prepared = await f.cancel();
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
  expect(await f.requests(prepared.sessionId)).toHaveLength(1);
});

async function expectInvalid(prepared: PreparedCancel, event: ClaimedEvent = prepared.event) {
  expect((await f.deliver(event)).delivered).toBe(false);
  await expect(f.consume(event)).rejects.toThrow('LINE_CANCEL_EVENT_INVALID');
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
  expect(
    await f.owner`SELECT event_id FROM consumed_events WHERE company_id=${event.companyId} AND consumer_id=${f.consumer.id} AND event_id=${event.id}`,
  ).toHaveLength(0);
}
function useCase(tx: Tx) {
  return new RequestLineCancelNotice(
    {
      recipients: lineCancelRecipients(tx),
      place: { branchPlace: async () => null },
      repository: lineCancelRepository(tx),
      outbox: lineCancelOutbox(tx),
      rules: alertRules(tx),
    },
    f.ids,
    { now: () => f.at },
    catalogFallback(),
  );
}
function catalogFallback(): LineCancelNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    safeName: safeDisplayName,
  };
}
