import { teamAlertDelivery, teamAlertRecipientGroups, type AlertChannel } from '@pospay/domain';
import {
  assertDiscountSelfApprovalEventValues,
  discountSelfApprovalRecipientGroups,
  maxSelfApprovalEffectiveBps,
  selfApprovalNoticeParameters,
  type DiscountSelfApprovalNoticeNameFallback,
} from '../../domain/discount-self-approval-notice.ts';
import type { Clock, IdGenerator } from '../../ports/late-service-session-notice.port.ts';
import type {
  DiscountSelfApprovalNoticeEvent,
  DiscountSelfApprovalNoticePorts,
} from '../../ports/discount-self-approval-notice.port.ts';
import { readRequiredTeamAlertContacts } from '../read-team-alert-contacts.ts';

/** يطلب جرس موافقة الموافِق على عمله مرة واحدة لكل حدث مصدر داخل معاملة المستهلك. */
export class RequestDiscountSelfApprovalNotice {
  constructor(
    private readonly ports: DiscountSelfApprovalNoticePorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly fallback: DiscountSelfApprovalNoticeNameFallback,
  ) {}

  async execute(input: DiscountSelfApprovalNoticeEvent): Promise<void> {
    assertDiscountSelfApprovalEventValues(input.proposals);
    if (!(await this.ports.repository.matchesProposals(input)))
      throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
    if (!(await this.ports.recipients.companyOpen(input.companyId))) return;
    const { roles, channels } = teamAlertDelivery(
      await this.ports.rules.rule(
        input.companyId,
        { businessId: input.businessId, branchId: input.branchId },
        'DISCOUNT_SELF_APPROVED',
      ),
    );
    const decidedAt = this.clock.now();
    const users = await this.ports.recipients.roleRecipients(input, decidedAt, roles);
    const branch = await this.ports.place.branchPlace(input);
    // فرع لم يعد موجودًا حالة نهائية لا تصلحها إعادة المحاولة: تُسجَّل كقرار بلا مستلمين
    // مثل «لا مالك في النطاق» فلا يتكرر الحدث ولا يخرج جرس.
    const { groups, recipientCount } = discountSelfApprovalRecipientGroups(
      branch === null ? [] : users,
    );
    const ledgerRowId = this.ids.newId();
    const won = await this.ports.repository.claim(input, {
      id: ledgerRowId,
      sourceEventId: input.sourceEventId,
      decidedAt,
      recipientCount,
    });
    // قاعدة مقفولة أو من غير قنوات معناها قنوات فاضية وأدوار فاضية، فهي قرار صفر مستلمين زي «لا مالك في النطاق».
    if (!won || branch === null || recipientCount === 0 || channels.length === 0) return;
    await this.publish(input, ledgerRowId, branch, groups.flat(), channels, decidedAt);
  }

  private async publish(
    input: DiscountSelfApprovalNoticeEvent,
    ledgerRowId: string,
    branch: { nameAr: string | null; nameEn: string },
    userIds: readonly string[],
    channels: readonly AlertChannel[],
    decidedAt: Date,
  ): Promise<void> {
    const service = input.proposals[0];
    if (service === undefined) throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
    const parameters = selfApprovalNoticeParameters({
      branch,
      approver: { labelAr: input.deciderLabelAr, labelEn: input.deciderLabelEn },
      service: { nameAr: service.nameAr, nameEn: service.nameEn },
      maxEffectiveBps: maxSelfApprovalEffectiveBps(input.proposals),
      fallback: this.fallback,
    });
    const contacts = await readRequiredTeamAlertContacts({
      channels,
      userIds,
      companyId: input.companyId,
      at: decidedAt,
      contacts: this.ports.contacts,
    });
    const recipientGroups = teamAlertRecipientGroups({
      channels,
      userIds,
      templateKey: 'discount_self_approved',
      contacts,
      inApp: (user_id) => ({
        channel: 'IN_APP' as const,
        user_id,
        locale: 'ar' as const,
        template_key: 'discount_self_approved' as const,
        template_revision: 1 as const,
        safe_parameters: parameters,
      }),
    });
    for (const group of recipientGroups) await this.append(input, ledgerRowId, group);
  }

  private async append(
    input: DiscountSelfApprovalNoticeEvent,
    ledgerRowId: string,
    group: Parameters<DiscountSelfApprovalNoticePorts['outbox']['append']>[2]['notification_recipients'],
  ): Promise<void> {
    await this.ports.outbox.append(this.ids.newId(), ledgerRowId, {
      schema_version: 1,
      business_id: input.businessId,
      branch_id: input.branchId,
      proposal_ids: input.proposals.map((proposal) => proposal.id),
      notification_recipients: group,
    });
  }
}
