import {
  assertLineCancelEventValues,
  interimLineCancelNoticeRule,
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
    const decidedAt = this.clock.now();
    const users = await this.ports.recipients.branchManagerRecipients(
      input,
      decidedAt,
      interimLineCancelNoticeRule().roles,
    );
    const history = await this.ports.repository.readCancellation(input.companyId, input.lineId);
    if (
      history === null ||
      history.revision !== input.revision ||
      history.previousNet !== input.cancelledNet
    )
      throw new Error('LINE_CANCEL_EVENT_INVALID');
    const { groups, recipientCount } = lineCancelRecipientGroups(users);
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
    input: LineCancelNoticeInput,
    groups: readonly (readonly string[])[],
  ): Promise<void> {
    const branch = await this.ports.place.branchPlace(input);
    if (branch === null) throw new Error('LINE_CANCEL_PLACE_INVALID');
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
      await this.append(input, context.businessTimezone, group, parameters);
  }

  private async append(
    input: LineCancelNoticeInput,
    businessTimezone: string,
    group: readonly string[],
    parameters: LineCancelParameters,
  ): Promise<void> {
    const channel = interimLineCancelNoticeRule().channel;
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
