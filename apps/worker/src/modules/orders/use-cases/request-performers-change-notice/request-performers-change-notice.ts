import { teamAlertDelivery, teamAlertRecipientGroups, type AlertChannel } from '@pospay/domain';
import {
  assertPerformersChangeEventValues,
  performersChangeMatchesHistory,
  performersChangeNoticeParameters,
  performersChangeRecipientGroups,
  type PerformerShare,
  type PerformersChangeNameFallback,
} from '../../domain/performers-change-notice.ts';
import type {
  Clock,
  IdGenerator,
  PerformersChangeNoticeLine,
  PerformersChangeNoticePorts,
} from '../../ports/performers-change-notice.port.ts';
import { readRequiredTeamAlertContacts } from '../read-team-alert-contacts.ts';

/** يطلب جرس تغيير المنفّذين مرة لكل (سطر، مراجعة) داخل معاملة المستهلك. */
export class RequestPerformersChangeNotice {
  constructor(
    private readonly ports: PerformersChangeNoticePorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly fallback: PerformersChangeNameFallback,
  ) {}

  async execute(input: PerformersChangeNoticeInput): Promise<void> {
    assertPerformersChangeEventValues(input);
    if (!(await this.ports.repository.matchesLine(input)))
      throw new Error('LINE_PERFORMERS_EVENT_INVALID');
    if (!(await this.ports.recipients.companyOpen(input.companyId))) return;
    const { roles, channels } = teamAlertDelivery(
      await this.ports.rules.rule(
        input.companyId,
        { businessId: input.businessId, branchId: input.branchId },
        'SERVICE_LINE_PERFORMERS_CHANGED',
      ),
    );
    const decidedAt = this.clock.now();
    const users = await this.ports.recipients.branchManagerRecipients(input, decidedAt, roles);
    const history = await this.ports.repository.readPerformerChange(
      input.companyId,
      input.lineId,
      input.revision,
    );
    if (!performersChangeMatchesHistory(history, input))
      throw new Error('LINE_PERFORMERS_EVENT_INVALID');
    const branch = await this.ports.place.branchPlace(input);
    // فرع لم يعد موجودًا حالة نهائية لا تصلحها إعادة المحاولة: تُسجَّل كقرار بلا مستلمين
    // مثل «لا مدير في النطاق» فلا يتكرر الحدث ولا يخرج جرس.
    const { groups, recipientCount } = performersChangeRecipientGroups(
      branch === null ? [] : users,
    );
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
    input: PerformersChangeNoticeInput,
    branch: Parameters<typeof performersChangeNoticeParameters>[0]['branch'],
    userIds: readonly string[],
    channels: readonly AlertChannel[],
    decidedAt: Date,
  ): Promise<void> {
    const context = await this.ports.repository.readLineContext(input);
    if (context === null) throw new Error('LINE_PERFORMERS_EVENT_INVALID');
    const parameters = performersChangeNoticeParameters({
      service: context,
      branch,
      businessDate: input.businessDate,
      lineNet: input.lineNet,
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
      templateKey: 'service_line_performers_changed',
      contacts,
      inApp: (user_id) => ({
        channel: 'IN_APP' as const,
        user_id,
        locale: 'ar' as const,
        template_key: 'service_line_performers_changed' as const,
        template_revision: 1 as const,
        safe_parameters: parameters,
      }),
    });
    for (const group of recipientGroups) await this.append(input, context.businessTimezone, group);
  }

  private async append(
    input: PerformersChangeNoticeInput,
    businessTimezone: string,
    group: Parameters<PerformersChangeNoticePorts['outbox']['append']>[1]['notification_recipients'],
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
export interface PerformersChangeNoticeInput extends PerformersChangeNoticeLine {
  readonly sourceEventId: string;
  readonly lineNet: string;
  readonly performers: readonly PerformerShare[];
  readonly previousRevision: number;
  readonly previousPerformers: readonly PerformerShare[];
}
