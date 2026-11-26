import {
  assertPackageRefundEventValues,
  packageRefundNoticeParameters,
  packageRefundRecipientGroups,
  type PackageRefundNameFallback,
  type PackageRefundParameters,
} from '../../domain/package-refund-notice.ts';
import type {
  Clock,
  IdGenerator,
  PackageRefundNoticePorts,
  PackageRefundNoticeRefund,
} from '../../ports/package-refund-notice.port.ts';

/** أدوار مديري الفرع الأربعة؛ المسترد نفسه مش مستثنى (FR-056)، وalert_rules ما بتتلمسش. */
const BRANCH_MANAGER_ROLES = [
  'owner',
  'general_manager',
  'business_manager',
  'branch_manager',
] as const;

/** يطلب جرس استرداد الباقة مرة لكل استرداد داخل معاملة المستهلك. */
export class RequestPackageRefundNotice {
  constructor(
    private readonly ports: PackageRefundNoticePorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly fallback: PackageRefundNameFallback,
  ) {}

  async execute(input: PackageRefundNoticeInput): Promise<void> {
    assertPackageRefundEventValues({
      businessDate: input.businessDate,
      amount: input.amount,
      sessions: input.sessions,
    });
    if (!(await this.ports.repository.matchesRefund(input)))
      throw new Error('PACKAGE_REFUND_EVENT_INVALID');
    if (!(await this.ports.recipients.companyOpen(input.companyId))) return;
    const decidedAt = this.clock.now();
    const users = await this.ports.recipients.branchManagerRecipients(
      input,
      decidedAt,
      BRANCH_MANAGER_ROLES,
    );
    const branch = await this.ports.place.branchPlace(input);
    // فرع لم يعد موجودًا حالة نهائية لا تصلحها إعادة المحاولة: تُسجَّل كقرار بلا مستلمين
    // مثل «لا مدير في النطاق» فلا يتكرر الحدث ولا يخرج جرس.
    const { groups, recipientCount } = packageRefundRecipientGroups(branch === null ? [] : users);
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
    input: PackageRefundNoticeInput,
    branch: { nameAr: string | null; nameEn: string },
    groups: readonly (readonly string[])[],
  ): Promise<void> {
    const context = await this.ports.repository.readRefundContext(input);
    if (context === null) throw new Error('PACKAGE_REFUND_EVENT_INVALID');
    const parameters = packageRefundNoticeParameters({
      packageName: { nameAr: context.packageNameAr, nameEn: context.packageNameEn },
      branch,
      sessions: input.sessions,
      amount: input.amount,
      businessDate: input.businessDate,
      fallback: this.fallback,
    });
    for (const group of groups)
      await this.append(input, context.businessTimezone, group, parameters);
  }

  private async append(
    input: PackageRefundNoticeInput,
    businessTimezone: string,
    group: readonly string[],
    parameters: PackageRefundParameters,
  ): Promise<void> {
    await this.ports.outbox.append(this.ids.newId(), {
      schema_version: 1,
      refund_id: input.refundId,
      entitlement_id: input.entitlementId,
      business_id: input.businessId,
      branch_id: input.branchId,
      business_date: input.businessDate,
      business_timezone: businessTimezone,
      notification_recipients: group.map((user_id) => ({
        channel: 'IN_APP' as const,
        user_id,
        locale: 'ar' as const,
        template_key: 'package_refund_recorded' as const,
        template_revision: 1 as const,
        safe_parameters: parameters,
      })),
    });
  }
}

export interface PackageRefundNoticeInput extends PackageRefundNoticeRefund {
  readonly sourceEventId: string;
}
