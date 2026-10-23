import { bellDelivery } from '../../domain/alert-rule-bell.ts';
import {
  assertLineCancelEventValues,
  lineCancelNoticeParameters,
  lineCancelRecipientGroups,
  type LineCancelNameFallback,
  type LineCancelParameters,
} from '../../domain/line-cancel-notice.ts';
import type {
  Clock,
  IdGenerator,
  LineCancelNoticeLine,
  LineCancelNoticePorts,
} from '../../ports/line-cancel-notice.port.ts';

/** يطلب جرس إلغاء السطر مرة لكل (سطر، مراجعة) داخل معاملة المستهلك. */
export class RequestLineCancelNotice {
  constructor(
    private readonly ports: LineCancelNoticePorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly fallback: LineCancelNameFallback,
  ) {}

  async execute(input: LineCancelNoticeInput): Promise<void> {
    assertLineCancelEventValues(input);
    if (!(await this.ports.repository.matchesLine(input)))
      throw new Error('LINE_CANCEL_EVENT_INVALID');
    if (!(await this.ports.recipients.companyOpen(input.companyId))) return;
    const { roles, channel } = bellDelivery(
      await this.ports.rules.rule(
        input.companyId,
        { businessId: input.businessId, branchId: input.branchId },
        'SERVICE_LINE_CANCELLED',
      ),
    );
    const decidedAt = this.clock.now();
    const users = await this.ports.recipients.branchManagerRecipients(input, decidedAt, roles);
    const history = await this.ports.repository.readCancellation(input.companyId, input.lineId);
    if (
      history === null ||
      history.revision !== input.revision ||
      history.previousNet !== input.cancelledNet
    )
      throw new Error('LINE_CANCEL_EVENT_INVALID');
    const branch = await this.ports.place.branchPlace(input);
    // فرع لم يعد موجودًا حالة نهائية لا تصلحها إعادة المحاولة: تُسجَّل كقرار بلا مستلمين
    // مثل «لا مدير في النطاق» فلا يتكرر الحدث ولا يخرج جرس.
    const { groups, recipientCount } = lineCancelRecipientGroups(branch === null ? [] : users);
    const won = await this.ports.repository.claim(input, {
      id: this.ids.newId(),
      sourceEventId: input.sourceEventId,
      decidedAt,
      recipientCount,
    });
    // قاعدة مقفولة معناها قناة null وأدوار فاضية، فهي قرار صفر مستلمين زي «لا مدير في النطاق»؛
    // الشرط ده بيحافظ على نوع القناة من غير cast.
    if (!won || branch === null || recipientCount === 0 || channel === null) return;
    await this.publish(input, branch, groups, channel);
  }

  private async publish(
    input: LineCancelNoticeInput,
    branch: Parameters<typeof lineCancelNoticeParameters>[0]['branch'],
    groups: readonly (readonly string[])[],
    channel: 'IN_APP',
  ): Promise<void> {
    const context = await this.ports.repository.readLineContext(input);
    if (context === null) throw new Error('LINE_CANCEL_EVENT_INVALID');
    const parameters = lineCancelNoticeParameters({
      service: context,
      branch,
      businessDate: input.businessDate,
      cancelledNet: input.cancelledNet,
      fallback: this.fallback,
    });
    for (const group of groups)
      await this.append(input, context.businessTimezone, group, parameters, channel);
  }

  private async append(
    input: LineCancelNoticeInput,
    businessTimezone: string,
    group: readonly string[],
    parameters: LineCancelParameters,
    channel: 'IN_APP',
  ): Promise<void> {
    await this.ports.outbox.append(this.ids.newId(), {
      schema_version: 1,
      session_id: input.sessionId,
      line_id: input.lineId,
      revision: input.revision,
      business_id: input.businessId,
      branch_id: input.branchId,
      business_date: input.businessDate,
      business_timezone: businessTimezone,
      notification_recipients: group.map((user_id) => ({
        channel,
        user_id,
        locale: 'ar' as const,
        template_key: 'service_line_cancelled' as const,
        template_revision: 1 as const,
        safe_parameters: parameters,
      })),
    });
  }
}
export interface LineCancelNoticeInput extends LineCancelNoticeLine {
  readonly sourceEventId: string;
  readonly businessDate: string;
  readonly cancelledNet: string;
}
