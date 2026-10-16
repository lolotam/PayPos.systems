import {
  interimPriceEditNoticeRule,
  priceEditEditorLabel,
  priceEditNoticeParameters,
  priceEditRecipientGroups,
  type PriceEditEditorLabel,
  type PriceEditNameFallback,
  type PriceEditParameters,
} from '../../domain/price-edit-notice.ts';
import type {
  Clock,
  IdGenerator,
  PriceEditNoticeLine,
  PriceEditNoticePorts,
} from '../../ports/price-edit-notice.port.ts';

/** يطلب جرس تعديل السعر مرة لكل (سطر، مراجعة) داخل معاملة المستهلك. */
export class RequestPriceEditNotice {
  constructor(
    private readonly ports: PriceEditNoticePorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly fallback: PriceEditNameFallback,
  ) {}

  async execute(input: PriceEditNoticeInput): Promise<void> {
    if (!(await this.ports.repository.matchesLine(input)))
      throw new Error('PRICE_EDIT_EVENT_INVALID');
    if (!(await this.ports.recipients.companyOpen(input.companyId))) return;
    const rule = interimPriceEditNoticeRule();
    const decidedAt = this.clock.now();
    const users = await this.ports.recipients.branchManagerRecipients(input, decidedAt, rule.roles);
    const snapshot = await this.ports.repository.readEditSnapshot(
      input.companyId,
      input.lineId,
      input.revision,
    );
    if (
      snapshot === null ||
      snapshot.previousNet !== input.previousNet ||
      snapshot.newNet !== input.newNet
    )
      throw new Error('PRICE_EDIT_EVENT_INVALID');
    const editor = priceEditEditorLabel(
      { nameAr: snapshot.editorNameAr, nameEn: snapshot.editorNameEn, role: snapshot.editorRole },
      this.fallback,
    );
    const { groups, recipientCount } = priceEditRecipientGroups(users);
    const won = await this.ports.repository.claim(input, {
      id: this.ids.newId(),
      sourceEventId: input.sourceEventId,
      decidedAt,
      recipientCount,
    });
    if (!won || recipientCount === 0) return;
    await this.publish(input, editor, groups, rule.channel);
  }

  private async publish(
    input: PriceEditNoticeInput,
    editor: PriceEditEditorLabel,
    groups: readonly (readonly string[])[],
    channel: 'IN_APP',
  ): Promise<void> {
    const branch = await this.ports.place.branchPlace(input);
    if (branch === null) throw new Error('PRICE_EDIT_PLACE_INVALID');
    const context = await this.ports.repository.readLineContext(input);
    if (context === null) throw new Error('PRICE_EDIT_EVENT_INVALID');
    const parameters = priceEditNoticeParameters({
      service: context,
      branch,
      businessDate: input.businessDate,
      previousNet: input.previousNet,
      newNet: input.newNet,
      editor,
      fallback: this.fallback,
    });
    for (const group of groups) await this.append(input, context.businessTimezone, group, channel, parameters);
  }

  private async append(
    input: PriceEditNoticeInput,
    businessTimezone: string,
    group: readonly string[],
    channel: 'IN_APP',
    parameters: PriceEditParameters,
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
        template_key: 'service_line_price_edited' as const,
        template_revision: 1 as const,
        safe_parameters: parameters,
      })),
    });
  }
}
export interface PriceEditNoticeInput extends PriceEditNoticeLine {
  readonly sourceEventId: string;
  readonly businessDate: string;
  readonly previousNet: string;
  readonly newNet: string;
}
