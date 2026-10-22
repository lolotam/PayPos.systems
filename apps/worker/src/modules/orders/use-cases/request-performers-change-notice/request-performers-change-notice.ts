import { bellDelivery } from '../../domain/alert-rule-bell.ts';
import {
  assertPerformersChangeEventValues,
  performersChangeMatchesHistory,
  performersChangeNoticeParameters,
  performersChangeRecipientGroups,
  type PerformerShare,
  type PerformersChangeNameFallback,
  type PerformersChangeParameters,
} from '../../domain/performers-change-notice.ts';
import type {
  Clock,
  IdGenerator,
  PerformersChangeNoticeLine,
  PerformersChangeNoticePorts,
} from '../../ports/performers-change-notice.port.ts';

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
    const { roles, channel } = bellDelivery(
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
    // قاعدة مقفولة معناها قناة null وأدوار فاضية، فهي قرار صفر مستلمين زي «لا مدير في النطاق»؛
    // الشرط ده بيحافظ على نوع القناة من غير cast.
    if (!won || branch === null || recipientCount === 0 || channel === null) return;
    await this.publish(input, branch, groups, channel);
  }

  private async publish(
    input: PerformersChangeNoticeInput,
    branch: Parameters<typeof performersChangeNoticeParameters>[0]['branch'],
    groups: readonly (readonly string[])[],
    channel: 'IN_APP',
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
    for (const group of groups)
      await this.append(input, context.businessTimezone, group, parameters, channel);
  }

  private async append(
    input: PerformersChangeNoticeInput,
    businessTimezone: string,
    group: readonly string[],
    parameters: PerformersChangeParameters,
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
        template_key: 'service_line_performers_changed' as const,
        template_revision: 1 as const,
        safe_parameters: parameters,
      })),
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
