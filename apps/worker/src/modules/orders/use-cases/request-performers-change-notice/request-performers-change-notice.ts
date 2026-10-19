import {
  assertPerformersChangeEventValues,
  interimPerformersChangeNoticeRule,
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
    const decidedAt = this.clock.now();
    const users = await this.ports.recipients.branchManagerRecipients(
      input,
      decidedAt,
      interimPerformersChangeNoticeRule().roles,
    );
    const history = await this.ports.repository.readPerformerChange(
      input.companyId,
      input.lineId,
      input.revision,
    );
    if (!performersChangeMatchesHistory(history, input))
      throw new Error('LINE_PERFORMERS_EVENT_INVALID');
    const { groups, recipientCount } = performersChangeRecipientGroups(users);
    const won = await this.ports.repository.claim(input, {
      id: this.ids.newId(),
      sourceEventId: input.sourceEventId,
      decidedAt,
      recipientCount,
    });
    if (!won || recipientCount === 0) return;
    await this.publish(input, groups);
  }

  private async publish(
    input: PerformersChangeNoticeInput,
    groups: readonly (readonly string[])[],
  ): Promise<void> {
    const branch = await this.ports.place.branchPlace(input);
    if (branch === null) throw new Error('LINE_PERFORMERS_PLACE_INVALID');
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
      await this.append(input, context.businessTimezone, group, parameters);
  }

  private async append(
    input: PerformersChangeNoticeInput,
    businessTimezone: string,
    group: readonly string[],
    parameters: PerformersChangeParameters,
  ): Promise<void> {
    const channel = interimPerformersChangeNoticeRule().channel;
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
