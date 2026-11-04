import { discountSelfApprovalNoticeRequested } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { safeDisplayName, t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { DiscountSelfApprovalNoticeNameFallback } from '../domain/discount-self-approval-notice.ts';
import { onDiscountApprovedByPerformer } from '../events/handlers/on-discount-approved-by-performer.handler.ts';
import { alertRules } from '../persistence/alert-rule.adapter.ts';
import { discountSelfApprovalRecipients } from '../persistence/discount-self-approval-recipients.adapter.ts';
import {
  discountSelfApprovalOutbox,
  discountSelfApprovalRepository,
} from '../persistence/discount-self-approval-notice.repository.ts';
import { RequestDiscountSelfApprovalNotice } from '../use-cases/request-discount-self-approval-notice/request-discount-self-approval-notice.ts';
import type { SelfApprovalScope } from './discount-self-approval-notice-data.ts';
import {
  discountSelfApprovalFixture,
  type DiscountSelfApprovalFixture,
} from './discount-self-approval-notice.fixture.ts';

let f: DiscountSelfApprovalFixture;
beforeAll(async () => {
  f = await discountSelfApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('DP-19c: the default rule rings both owners including the approving one, and never the non-owner manager', async () => {
  const otherOwner = await f.user();
  await f.member(otherOwner, 'owner');
  const manager = await f.user();
  await f.member(manager, 'branch_manager', 'BRANCH', f.tenant.branch);
  const prepared = await f.decision({ proposals: 2, announcedBps: 2500, storedBps: 2500 });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
  expect(ledger).toMatchObject({ recipient_count: 2, decided_at: f.at });
  const rows = await f.decisions(prepared.companyId, ledger?.['id'] as string);
  expect(rows).toHaveLength(1);
  const payload = discountSelfApprovalNoticeRequested.parse(rows[0]?.['payload']);
  expect(payload.business_id).toBe(prepared.businessId);
  expect(payload.branch_id).toBe(prepared.branchId);
  expect(payload.proposal_ids).toEqual([...prepared.proposalIds].sort());
  expect(payload.notification_recipients.map((recipient) => recipient.user_id).sort()).toEqual(
    [otherOwner, USER].sort(),
  );
  expect(payload.notification_recipients.map((recipient) => recipient.user_id)).not.toContain(
    manager,
  );
  expect(payload.notification_recipients[0]).toMatchObject({
    channel: 'IN_APP',
    locale: 'ar',
    template_key: 'discount_self_approved',
    template_revision: 1,
  });
  expect(payload.notification_recipients[0]?.safe_parameters.map((item) => item.name)).toEqual([
    'branch_name_ar',
    'branch_name_en',
    'approver_name_ar',
    'approver_name_en',
    'service_name_ar',
    'service_name_en',
    'max_percent',
  ]);
  expect(payload.notification_recipients[0]?.safe_parameters.map((item) => item.value)).toEqual([
    'Branch A',
    'Branch A',
    'موافق تجريبي',
    'Synthetic decider',
    'Synthetic service',
    'Synthetic service',
    '25',
  ]);
  const text = JSON.stringify(payload);
  expect(text).not.toContain('Synthetic customer');
  expect(text).not.toContain('+999999998123');
  expect(await f.consumed(prepared.companyId, prepared.event.id)).toHaveLength(1);
});

it('a single approving owner gets her own bell (DA-Q10)', async () => {
  const scope = await f.otherCompany();
  const approver = await f.user();
  const membership = await f.member(approver, 'owner', 'COMPANY', scope.company);
  const prepared = await f.decision({
    scope,
    decider: { userId: approver, membershipId: membership },
  });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
  expect(ledger).toMatchObject({ recipient_count: 1 });
  const rows = await f.decisions(prepared.companyId, ledger?.['id'] as string);
  expect(
    discountSelfApprovalNoticeRequested.parse(rows[0]?.['payload']).notification_recipients,
  ).toMatchObject([{ user_id: approver }]);
});

it('a redelivered event, even after deleting the consumed marker, keeps one ledger row and one notice', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  await f.owner`DELETE FROM consumed_events WHERE company_id=${prepared.companyId} AND consumer_id=${f.consumer.id} AND event_id=${prepared.event.id}`;
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(1);
  const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
  expect(await f.decisions(prepared.companyId, ledger?.['id'] as string)).toHaveLength(1);
});

it('two distinct event ids for the same decision claim two ledger rows', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope });
  const second = await f.again(prepared);
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.deliver(second)).toEqual({ delivered: true });
  expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(1);
  expect(await f.notices(second.companyId, second.id)).toHaveLength(1);
});

it('no owner at all records a zero decision: consumed, no bell, no error', async () => {
  const scope = await f.otherCompany();
  const decider = await f.deciderOf(scope.company);
  const prepared = await f.decision({ scope, decider });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
    { recipient_count: 0 },
  ]);
  const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
  expect(await f.decisions(prepared.companyId, ledger?.['id'] as string)).toHaveLength(0);
  expect(await f.consumed(prepared.companyId, prepared.event.id)).toHaveLength(1);
});

it('a closed company claims nothing and the event is still consumed', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope });
  await f.owner`UPDATE companies SET deleted_at=${f.at} WHERE id=${prepared.companyId}`;
  try {
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(0);
    expect(await f.consumed(prepared.companyId, prepared.event.id)).toHaveLength(1);
  } finally {
    await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${prepared.companyId}`;
  }
});

it('a missing branch place is recorded with no recipients and is not retried', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope });
  const deliver = createDeliverer(
    f.db,
    [
      {
        ...f.consumer,
        handle: (tx, event) => onDiscountApprovedByPerformer(useCase(tx), event),
      },
    ],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  expect(await deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
    { recipient_count: 0 },
  ]);
  const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
  expect(await f.decisions(prepared.companyId, ledger?.['id'] as string)).toHaveLength(0);
  expect(await f.consumed(prepared.companyId, prepared.event.id)).toHaveLength(1);
});

it('a malformed payload throws before any claim: no ledger row, no bell for this event', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope, malformed: true });
  const outcome = await f.deliver(prepared.event);
  expect(outcome.delivered).toBe(false);
  expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE company_id=${prepared.companyId}
      AND event_type='DiscountSelfApprovalNoticeRequested' AND payload->>'business_id'=${prepared.businessId}`,
  ).toHaveLength(0);
});

it('an event whose proposals are already CONSUMED is accepted and rings the owner of that tenant', async () => {
  // زوج FK المؤجل للاستهلاك يشترط سطر خدمات بنفس الشركة، فالعزلة هنا بشركة B الكاملة لا بنطاق داخل A.
  const scopeB: SelfApprovalScope = {
    company: TENANT.B.company,
    business: TENANT.B.business,
    branch: TENANT.B.branch,
    service: ORDER_IDS.service,
    customer: ORDER_IDS.customer,
  };
  const prepared = await f.decision({ scope: scopeB, consume: true });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
    { recipient_count: 1 },
  ]);
});

function useCase(tx: Tx) {
  return new RequestDiscountSelfApprovalNotice(
    {
      recipients: discountSelfApprovalRecipients(tx),
      place: { branchPlace: async () => null },
      repository: discountSelfApprovalRepository(tx),
      outbox: discountSelfApprovalOutbox(tx),
      rules: alertRules(tx),
    },
    f.ids,
    { now: () => f.at },
    fallback(),
  );
}

function fallback(): DiscountSelfApprovalNoticeNameFallback {
  return {
    service: { ar: t('ar', 'serviceSessions.service'), en: t('en', 'serviceSessions.service') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    approver: { ar: t('ar', 'inApp.editor_generic'), en: t('en', 'inApp.editor_generic') },
    safeName: safeDisplayName,
  };
}
