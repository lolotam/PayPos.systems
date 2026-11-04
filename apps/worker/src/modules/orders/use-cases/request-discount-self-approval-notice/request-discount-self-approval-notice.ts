import { bellDelivery } from '../../domain/alert-rule-bell.ts';
import {
  assertDiscountSelfApprovalEventValues,
  discountSelfApprovalRecipientGroups,
  maxSelfApprovalEffectiveBps,
  selfApprovalNoticeParameters,
  type DiscountSelfApprovalNoticeNameFallback,
  type DiscountSelfApprovalNoticeParameters,
} from '../../domain/discount-self-approval-notice.ts';
import type { Clock, IdGenerator } from '../../ports/late-service-session-notice.port.ts';
import type {
  DiscountSelfApprovalNoticeEvent,
  DiscountSelfApprovalNoticePorts,
} from '../../ports/discount-self-approval-notice.port.ts';

/** يطلب جرس «الموافقة على خصم على شغل الموافِق» مرة واحدة لكل حدث مصدر داخل معاملة المستهلك. */
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
    const { roles, channel } = bellDelivery(
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
    // مثل «قاعدة مقفولة» فلا يتكرر الحدث ولا يخرج جرس.
    const { groups, recipientCount } = discountSelfApprovalRecipientGroups(
      branch === null ? [] : users,
    );
    const decision = {
      id: this.ids.newId(),
      sourceEventId: input.sourceEventId,
      decidedAt,
      recipientCount,
    };
    const won = await this.ports.repository.claim(input, decision);
    // قاعدة مقفولة أو بلا قناة داخل التطبيق معناها قرار صفر مستلمين، ولو تغيّرت القاعدة لاحقًا
    // يبقى الدفتر الفائز هو المرجع فلا يُعاد عدّ المستلمين أبدًا.
    if (!won || branch === null || recipientCount === 0 || channel === null) return;
    await this.publish(input, branch, groups, decision.id);
  }

  private async publish(
    input: DiscountSelfApprovalNoticeEvent,
    branch: { nameAr: string | null; nameEn: string },
    groups: readonly (readonly string[])[],
    decisionId: string,
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
    for (const group of groups) await this.append(input, decisionId, group, parameters);
  }

  private async append(
    input: DiscountSelfApprovalNoticeEvent,
    decisionId: string,
    group: readonly string[],
    parameters: DiscountSelfApprovalNoticeParameters,
  ): Promise<void> {
    await this.ports.outbox.append(this.ids.newId(), decisionId, {
      schema_version: 1,
      business_id: input.businessId,
      branch_id: input.branchId,
      proposal_ids: input.proposals.map((proposal) => proposal.id),
      notification_recipients: group.map((user_id) => ({
        channel: 'IN_APP' as const,
        user_id,
        locale: 'ar' as const,
        template_key: 'discount_self_approved' as const,
        template_revision: 1 as const,
        safe_parameters: parameters,
      })),
    });
  }
}
