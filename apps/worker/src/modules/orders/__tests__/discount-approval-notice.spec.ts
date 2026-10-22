import { discountApprovalNoticeRequested } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { safeDisplayName, t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import type { DiscountApprovalNoticeNameFallback } from '../domain/discount-approval-notice.ts';
import { onDiscountApprovalRequested } from '../events/handlers/on-discount-approval-requested.handler.ts';
import { discountApprovalRecipients } from '../persistence/discount-approval-recipients.adapter.ts';
import {
  discountApprovalOutbox,
  discountApprovalRepository,
} from '../persistence/discount-approval-notice.repository.ts';
import { RequestDiscountApprovalNotice } from '../use-cases/request-discount-approval-notice/request-discount-approval-notice.ts';
import {
  discountApprovalFixture,
  type DiscountApprovalFixture,
} from './discount-approval-notice.fixture.ts';

let f: DiscountApprovalFixture;
beforeAll(async () => {
  f = await discountApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('one request with two lines rings once for every approver and never for the requester', async () => {
  const scope = await f.otherScope();
  const approver = await f.user();
  await f.member(approver, 'branch_manager', 'BRANCH', scope.branch);
  const request = await f.request({ scope, lines: 2 });
  expect(await f.deliver(request.event)).toEqual({ delivered: true });
  expect(await f.notices(request.requestId)).toMatchObject([{ recipient_count: 1 }]);
  const rows = await f.requests(request.requestId);
  expect(rows).toHaveLength(1);
  const payload = discountApprovalNoticeRequested.parse(rows[0]?.['payload']);
  expect(payload.request_id).toBe(request.requestId);
  expect(payload.notification_recipients.map((recipient) => recipient.user_id)).toEqual([approver]);
  expect(payload.notification_recipients.map((recipient) => recipient.user_id)).not.toContain(USER);
  expect(payload.notification_recipients[0]).toMatchObject({
    channel: 'IN_APP',
    locale: 'ar',
    template_key: 'discount_approval_requested',
    template_revision: 1,
  });
  expect(payload.notification_recipients[0]?.safe_parameters.map((item) => item.name)).toEqual([
    'branch_name_ar',
    'branch_name_en',
    'service_name_ar',
    'service_name_en',
    'line_count',
    'max_percent',
  ]);
  expect(payload.notification_recipients[0]?.safe_parameters.map((item) => item.value)).toEqual([
    'Other branch',
    'Other branch',
    'Synthetic service',
    'Synthetic service',
    '2',
    '20',
  ]);
});

it('a redelivered event keeps one ledger row and one notice', async () => {
  const scope = await f.otherScope();
  const approver = await f.user();
  await f.member(approver, 'branch_manager', 'BRANCH', scope.branch);
  const request = await f.request({ scope, lines: 1 });
  expect(await f.deliver(request.event)).toEqual({ delivered: true });
  expect(await f.deliver(request.event)).toEqual({ delivered: true });
  await f.owner`DELETE FROM consumed_events WHERE company_id=${request.companyId} AND consumer_id=${f.consumer.id} AND event_id=${request.event.id}`;
  expect(await f.deliver(request.event)).toEqual({ delivered: true });
  expect(await f.notices(request.requestId)).toHaveLength(1);
  expect(await f.requests(request.requestId)).toHaveLength(1);
  expect(await f.consumed(request.event.id)).toHaveLength(1);
});

it('a second event for the same request rings no second bell', async () => {
  const scope = await f.otherScope();
  const approver = await f.user();
  await f.member(approver, 'branch_manager', 'BRANCH', scope.branch);
  const request = await f.request({ scope, lines: 1 });
  expect(await f.deliver(request.event)).toEqual({ delivered: true });
  const second = await f.again(request);
  expect(await f.deliver(second)).toEqual({ delivered: true });
  expect(await f.notices(request.requestId)).toHaveLength(1);
  expect(await f.requests(request.requestId)).toHaveLength(1);
});

it('only the requester holds the permission, so the ledger records zero recipients and no bell', async () => {
  const scope = await f.otherScope();
  const request = await f.request({ scope, lines: 1 });
  expect(await f.deliver(request.event)).toEqual({ delivered: true });
  expect(await f.notices(request.requestId)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.requests(request.requestId)).toHaveLength(0);
  expect(await f.consumed(request.event.id)).toHaveLength(1);
});

it('a closed company claims nothing', async () => {
  const scope = await f.otherScope();
  const request = await f.request({ scope, lines: 1 });
  await f.owner`UPDATE companies SET deleted_at=${f.at} WHERE id=${request.companyId}`;
  try {
    expect(await f.deliver(request.event)).toEqual({ delivered: true });
    expect(await f.notices(request.requestId)).toHaveLength(0);
    expect(await f.requests(request.requestId)).toHaveLength(0);
    expect(await f.consumed(request.event.id)).toHaveLength(1);
  } finally {
    await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${request.companyId}`;
  }
});

it('a missing branch place is recorded with no recipients and is not retried', async () => {
  const scope = await f.otherScope();
  const approver = await f.user();
  await f.member(approver, 'branch_manager', 'BRANCH', scope.branch);
  const request = await f.request({ scope, lines: 1 });
  const deliver = createDeliverer(
    f.db,
    [{ ...f.consumer, handle: (tx, event) => onDiscountApprovalRequested(useCase(tx), event) }],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  expect(await deliver(request.event)).toEqual({ delivered: true });
  expect(await f.notices(request.requestId)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.requests(request.requestId)).toHaveLength(0);
  expect(await f.consumed(request.event.id)).toHaveLength(1);
});

function useCase(tx: Tx) {
  return new RequestDiscountApprovalNotice(
    {
      recipients: discountApprovalRecipients(tx),
      place: { branchPlace: async () => null },
      repository: discountApprovalRepository(tx),
      outbox: discountApprovalOutbox(tx),
    },
    f.ids,
    { now: () => f.at },
    fallback(),
  );
}

function fallback(): DiscountApprovalNoticeNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    safeName: safeDisplayName,
  };
}
