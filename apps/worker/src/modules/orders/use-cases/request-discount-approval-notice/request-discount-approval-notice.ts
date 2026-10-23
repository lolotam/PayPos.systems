import {
  assertDiscountApprovalEventValues,
  discountApprovalNoticeParameters,
  discountApprovalRecipientGroups,
  type DiscountApprovalNoticeNameFallback,
  type DiscountApprovalNoticeParameters,
} from '../../domain/discount-approval-notice.ts';
import type { Clock, IdGenerator } from '../../ports/late-service-session-notice.port.ts';
import type {
  DiscountApprovalNoticePorts,
  DiscountApprovalNoticeRequest,
} from '../../ports/discount-approval-notice.port.ts';

/** يطلب جرس طلب الموافقة مرة واحدة لكل طلب داخل معاملة المستهلك. */
export class RequestDiscountApprovalNotice {
  constructor(
    private readonly ports: DiscountApprovalNoticePorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly fallback: DiscountApprovalNoticeNameFallback,
  ) {}

  async execute(input: RequestDiscountApprovalNoticeInput): Promise<void> {
    assertDiscountApprovalEventValues({
      lineCount: input.lineCount,
      maxEffectiveBps: input.maxEffectiveBps,
      serviceCount: input.services.length,
    });
    if (!(await this.ports.repository.matchesRequest(input)))
      throw new Error('DISCOUNT_APPROVAL_EVENT_INVALID');
    if (!(await this.ports.recipients.companyOpen(input.companyId))) return;
    const decidedAt = this.clock.now();
    const candidates = await this.ports.recipients.discountApproverRecipients(input, decidedAt);
    const recipients = candidates.filter((userId) => userId !== input.requestedBy);
    const branch = await this.ports.place.branchPlace(input);
    // فرع لم يعد موجودًا حالة نهائية لا تصلحها إعادة المحاولة: تُسجَّل كقرار بلا مستلمين
    // مثل «لا موافق في النطاق» فلا يتكرر الحدث ولا يخرج جرس.
    const { groups, recipientCount } = discountApprovalRecipientGroups(
      branch === null ? [] : recipients,
    );
    const won = await this.ports.repository.claim(input, {
      id: this.ids.newId(),
      sourceEventId: input.sourceEventId,
      decidedAt,
      recipientCount,
    });
    if (!won || branch === null || recipientCount === 0) return;
    await this.publish(input, branch, groups);
  }

  private async publish(
    input: RequestDiscountApprovalNoticeInput,
    branch: { nameAr: string | null; nameEn: string },
    groups: readonly (readonly string[])[],
  ): Promise<void> {
    const service = input.services[0];
    if (service === undefined) throw new Error('DISCOUNT_APPROVAL_EVENT_INVALID');
    const parameters = discountApprovalNoticeParameters({
      branch,
      service: { nameAr: service.nameAr, nameEn: service.nameEn },
      lineCount: input.lineCount,
      maxEffectiveBps: input.maxEffectiveBps,
      serviceCount: input.services.length,
      fallback: this.fallback,
    });
    for (const group of groups) await this.append(input, group, parameters);
  }

  private async append(
    input: RequestDiscountApprovalNoticeInput,
    group: readonly string[],
    parameters: DiscountApprovalNoticeParameters,
  ): Promise<void> {
    await this.ports.outbox.append(this.ids.newId(), {
      schema_version: 1,
      request_id: input.requestId,
      business_id: input.businessId,
      branch_id: input.branchId,
      notification_recipients: group.map((user_id) => ({
        channel: 'IN_APP' as const,
        user_id,
        locale: 'ar' as const,
        template_key: 'discount_approval_requested' as const,
        template_revision: 1 as const,
        safe_parameters: parameters,
      })),
    });
  }
}

/** مدخلات حالة الاستخدام: هوية الطلب كما أعلنها الحدث ومعرّف الحدث الذي سبّب الجرس. */
export interface RequestDiscountApprovalNoticeInput extends DiscountApprovalNoticeRequest {
  readonly sourceEventId: string;
}
