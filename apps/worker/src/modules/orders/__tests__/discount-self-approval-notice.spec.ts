import {
  discountSelfApprovalNoticeRequested,
  type DiscountSelfApprovalNoticeRequested,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { safeDisplayName, t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { DiscountSelfApprovalNoticeNameFallback } from '../domain/discount-self-approval-notice.ts';
import { onDiscountApprovedByPerformer } from '../events/handlers/on-discount-approved-by-performer.handler.ts';
import { alertRules } from '../persistence/alert-rule.adapter.ts';
import {
  discountSelfApprovalOutbox,
  discountSelfApprovalRepository,
} from '../persistence/discount-self-approval-notice.repository.ts';
import { discountSelfApprovalRecipients } from '../persistence/discount-self-approval-recipients.adapter.ts';
import { RequestDiscountSelfApprovalNotice } from '../use-cases/request-discount-self-approval-notice/request-discount-self-approval-notice.ts';
import type { ApprovalRequester, ApprovalScope } from './discount-approval-notice-data.ts';
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

it('both owners receive one bell when an owner approves her own work, with only safe display facts', async () => {
  const scope = await f.otherCompany();
  const ownerA = await companyMember(scope, 'owner');
  const ownerB = await companyMember(scope, 'owner');
  const prepared = await f.selfApproval({
    scope,
    decidedBy: ownerA,
    proposals: [{ bps: 1000 }, { bps: 2500 }],
  });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 2 }]);
  const rows = await f.bells(prepared.event.id);
  expect(rows).toHaveLength(1);
  const payload = bellPayload(rows);
  expect(payload.proposal_ids).toEqual(prepared.proposalIds);
  expect(recipientIds(payload).sort()).toEqual([ownerA.userId, ownerB.userId].sort());
  expect(payload.notification_recipients[0]).toMatchObject({
    channel: 'IN_APP',
    template_key: 'discount_self_approved',
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
    'Other branch',
    'Other branch',
    'مالك تجريبي',
    'Synthetic owner',
    'Synthetic service',
    'Synthetic service',
    '25',
  ]);
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain('Synthetic customer');
  expect(serialized).not.toMatch(/\+9\d/);
});

it('the approving owner receives her own bell in a single-owner salon', async () => {
  const scope = await f.otherCompany();
  const owner = await companyMember(scope, 'owner');
  const prepared = await f.selfApproval({ scope, decidedBy: owner });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 1 }]);
  expect(recipientIds(bellPayload(await f.bells(prepared.event.id)))).toEqual([owner.userId]);
});

it('a branch manager who approves gets no bell under the default rule while the owner does', async () => {
  const scope = await f.otherCompany();
  const owner = await companyMember(scope, 'owner');
  const manager = await branchMember(scope, 'branch_manager');
  const prepared = await f.selfApproval({ scope, decidedBy: manager });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(recipientIds(bellPayload(await f.bells(prepared.event.id)))).toEqual([owner.userId]);
  expect(recipientIds(bellPayload(await f.bells(prepared.event.id)))).not.toContain(manager.userId);
});

it('direct replay after dispatcher redelivery still keeps one ledger row and one bell', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  await f.owner`DELETE FROM consumed_events WHERE company_id=${prepared.companyId}
    AND consumer_id=${f.consumer.id} AND event_id=${prepared.event.id}`;
  await f.consume(prepared.event);
  expect(await f.notices(prepared.event.id)).toHaveLength(1);
  expect(await f.bells(prepared.event.id)).toHaveLength(1);
});

it('a malformed source payload is refused without a ledger row or a bell', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope, malformed: true });
  expect((await f.deliver(prepared.event)).delivered).toBe(false);
  await expect(f.consume(prepared.event)).rejects.toThrow('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  expect(await f.notices(prepared.event.id)).toHaveLength(0);
  expect(await f.bells(prepared.event.id)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(0);
});

it('no owner in scope records one zero-recipient decision and no bell', async () => {
  const scope = await f.otherCompany();
  const manager = await branchMember(scope, 'branch_manager');
  const prepared = await f.selfApproval({ scope, decidedBy: manager });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.bells(prepared.event.id)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(1);
});

it('a closed company records only the consumed receipt', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope });
  await f.owner`UPDATE companies SET deleted_at=${f.at} WHERE id=${prepared.companyId}`;
  try {
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.event.id)).toHaveLength(0);
    expect(await f.bells(prepared.event.id)).toHaveLength(0);
    expect(await f.consumed(prepared.event.id)).toHaveLength(1);
  } finally {
    await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${prepared.companyId}`;
  }
});

it('a missing branch place records one zero-recipient decision and no bell', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope });
  const deliver = createDeliverer(
    f.db,
    [{ ...f.consumer, handle: (tx, event) => onDiscountApprovedByPerformer(useCase(tx), event) }],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  expect(await deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.bells(prepared.event.id)).toHaveLength(0);
});

it('a failure after the real claim and bell insert rolls everything back and permits one retry', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope });
  await expect(
    f.db.withTenant(prepared.companyId, async (tx) => {
      await f.consumer.handle(tx, prepared.event);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(await f.notices(prepared.event.id)).toHaveLength(0);
  expect(await f.bells(prepared.event.id)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(0);
  await f.consume(prepared.event);
  expect(await f.notices(prepared.event.id)).toHaveLength(1);
  expect(await f.bells(prepared.event.id)).toHaveLength(1);
});

it('an owner of another company never appears among the recipients', async () => {
  const scope = await f.otherScope();
  const foreign = await f.user();
  await f.member(foreign, 'owner', 'COMPANY', TENANT.B.company, undefined, null, TENANT.B.company);
  const prepared = await f.selfApproval({ scope });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(recipientIds(bellPayload(await f.bells(prepared.event.id)))).toEqual([USER]);
});

it('a consumed proposal still proves the approval and produces one bell', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope, proposals: [{ status: 'CONSUMED' }] });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 1 }]);
  expect(await f.bells(prepared.event.id)).toHaveLength(1);
});

async function companyMember(scope: ApprovalScope, role: string): Promise<ApprovalRequester> {
  const userId = await f.user();
  const membershipId = await f.member(
    userId,
    role,
    'COMPANY',
    scope.company,
    undefined,
    null,
    scope.company,
  );
  return { userId, membershipId };
}

async function branchMember(scope: ApprovalScope, role: string): Promise<ApprovalRequester> {
  const userId = await f.user();
  const membershipId = await f.member(
    userId,
    role,
    'BRANCH',
    scope.branch,
    undefined,
    null,
    scope.company,
  );
  return { userId, membershipId };
}

function bellPayload(
  rows: readonly Record<string, unknown>[],
): DiscountSelfApprovalNoticeRequested {
  return discountSelfApprovalNoticeRequested.parse(rows[0]?.['payload']);
}

function recipientIds(payload: DiscountSelfApprovalNoticeRequested): string[] {
  return payload.notification_recipients.map((recipient) => recipient.user_id);
}

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
