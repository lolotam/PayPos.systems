import { teamAlertDelivery, teamAlertRecipientGroups, type AlertChannel } from '@pospay/domain';
import {
  assertLineCancelEventValues,
  lineCancelNoticeParameters,
  lineCancelRecipientGroups,
  type LineCancelNameFallback,
} from '../../domain/line-cancel-notice.ts';
import type {
  Clock,
  IdGenerator,
  LineCancelNoticeLine,
  LineCancelNoticePorts,
} from '../../ports/line-cancel-notice.port.ts';
import { readRequiredTeamAlertContacts } from '../read-team-alert-contacts.ts';

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
    const { roles, channels } = teamAlertDelivery(
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
    // قاعدة مقفولة أو من غير قنوات معناها قنوات فاضية وأدوار فاضية، فهي قرار صفر مستلمين زي «لا مدير في النطاق».
    if (!won || branch === null || recipientCount === 0 || channels.length === 0) return;
    await this.publish(input, branch, groups.flat(), channels, decidedAt);
  }

  private async publish(
    input: LineCancelNoticeInput,
    branch: Parameters<typeof lineCancelNoticeParameters>[0]['branch'],
    userIds: readonly string[],
    channels: readonly AlertChannel[],
    decidedAt: Date,
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
      templateKey: 'service_line_cancelled',
      contacts,
      inApp: (user_id) => ({
        channel: 'IN_APP' as const,
        user_id,
        locale: 'ar' as const,
        template_key: 'service_line_cancelled' as const,
        template_revision: 1 as const,
        safe_parameters: parameters,
      }),
    });
    for (const group of recipientGroups) await this.append(input, context.businessTimezone, group);
  }

  private async append(
    input: LineCancelNoticeInput,
    businessTimezone: string,
    group: Parameters<LineCancelNoticePorts['outbox']['append']>[1]['notification_recipients'],
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
      notification_recipients: group,
    });
  }
}
export interface LineCancelNoticeInput extends LineCancelNoticeLine {
  readonly sourceEventId: string;
  readonly businessDate: string;
  readonly cancelledNet: string;
}
