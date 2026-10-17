import type { ClaimedEvent, Tx } from '@pospay/db';
import { t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { PriceEditNameFallback } from '../domain/price-edit-notice.ts';
import { onServiceLineChanged } from '../events/handlers/on-service-line-changed.handler.ts';
import { priceEditRecipients } from '../persistence/price-edit-recipients.adapter.ts';
import {
  priceEditOutbox,
  priceEditRepository,
} from '../persistence/service-line-edit-notice.repository.ts';
import { RequestPriceEditNotice } from '../use-cases/request-price-edit-notice/request-price-edit-notice.ts';
import { priceEditFixture, type PriceEditFixture } from './price-edit-notice.fixture.ts';
import type { PreparedEdit } from './price-edit-data.ts';

let f: PriceEditFixture;
beforeAll(async () => {
  f = await priceEditFixture();
});
afterAll(async () => {
  await f?.close();
});

it('test 8: an absent change or another kind is consumed with no ledger row and no bell', async () => {
  const absent = await f.edit({ change: 'absent' });
  const other = await f.edit({ change: 'other' });
  expect(await f.deliver(absent.event)).toEqual({ delivered: true });
  expect(await f.deliver(other.event)).toEqual({ delivered: true });
  expect(await f.notices(absent.lineId)).toHaveLength(0);
  expect(await f.notices(other.lineId)).toHaveLength(0);
  expect(await f.requests(absent.sessionId)).toHaveLength(0);
  expect(await f.requests(other.sessionId)).toHaveLength(0);
  expect(await f.consumed(absent.event.id)).toHaveLength(1);
  expect(await f.consumed(other.event.id)).toHaveLength(1);
});

it('test 8: a closed company skips a matching edit', async () => {
  const prepared = await f.edit();
  await f.owner`UPDATE companies SET deleted_at=${f.at} WHERE id=${prepared.companyId}`;
  try {
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.lineId)).toHaveLength(0);
    expect(await f.consumed(prepared.event.id)).toHaveLength(1);
  } finally {
    await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${prepared.companyId}`;
  }
});

it('test 8: a malformed payload, a foreign company, a mismatched line, a missing history row or disagreeing money is invalid', async () => {
  await expectInvalid(await f.edit({ change: 'malformed' }));
  const foreign = await f.edit();
  await expectInvalid(foreign, { ...foreign.event, companyId: TENANT.B.company });
  await expectInvalid(await f.edit({ branchId: f.ids.newId() }));
  await expectInvalid(await f.edit({ revision: 3, lineRevision: 2 }));
  await expectInvalid(await f.edit({ history: false }));
  await expectInvalid(await f.edit({ eventPreviousNet: '3.500' }));
  await expectInvalid(await f.edit({ eventNewNet: '9.000' }));
  const badDate = await f.edit();
  (badDate.event.payload as { business_date: string }).business_date = '2026-02-30';
  await expectInvalid(badDate);
});

it('test 8: a future change kind with its own shape is consumed with no effect', async () => {
  const future = await f.edit();
  const payload = future.event.payload as { status: string; change: Record<string, unknown> };
  payload.status = 'CANCELLED';
  payload.change = { kind: 'LINE_CANCELLED' };
  expect(await f.deliver(future.event)).toEqual({ delivered: true });
  expect(await f.notices(future.lineId)).toHaveLength(0);
  expect(await f.consumed(future.event.id)).toHaveLength(1);
});

it('test 8: a non-matching line stays invalid while the company is closed', async () => {
  const prepared = await f.edit();
  await f.owner`UPDATE companies SET deleted_at=${f.at} WHERE id=${prepared.companyId}`;
  try {
    await expectInvalid(prepared, {
      ...prepared.event,
      payload: { ...(prepared.event.payload as Record<string, unknown>), line_id: f.ids.newId() },
    });
  } finally {
    await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${prepared.companyId}`;
  }
});

it('test 8: a missing branch place is invalid and rolls the ledger back', async () => {
  const prepared = await f.edit();
  const deliver = createDeliverer(
    f.db,
    [{ ...f.consumer, handle: (tx, event) => onServiceLineChanged(useCase(tx), event) }],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  expect((await deliver(prepared.event)).delivered).toBe(false);
  await expect(
    f.db.withTenant(prepared.companyId, (tx) => onServiceLineChanged(useCase(tx), prepared.event)),
  ).rejects.toThrow('PRICE_EDIT_PLACE_INVALID');
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(0);
});

it('test 8: a history row with no name and no role is invalid', async () => {
  await expectInvalid(
    await f.edit({ editorNameAr: null, editorNameEn: null, editorRole: null }),
  );
});

async function expectInvalid(prepared: PreparedEdit, event: ClaimedEvent = prepared.event) {
  expect((await f.deliver(event)).delivered).toBe(false);
  await expect(f.consume(event)).rejects.toThrow('PRICE_EDIT_EVENT_INVALID');
  expect(await f.notices(prepared.lineId)).toHaveLength(0);
  expect(
    await f.owner`SELECT event_id FROM consumed_events WHERE company_id=${event.companyId} AND consumer_id=${f.consumer.id} AND event_id=${event.id}`,
  ).toHaveLength(0);
}
function useCase(tx: Tx) {
  return new RequestPriceEditNotice(
    {
      recipients: priceEditRecipients(tx),
      place: { branchPlace: async () => null },
      repository: priceEditRepository(tx),
      outbox: priceEditOutbox(tx),
    },
    f.ids,
    { now: () => f.at },
    catalogFallback(),
  );
}
function catalogFallback(): PriceEditNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
  };
}
