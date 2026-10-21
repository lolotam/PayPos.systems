import { bellDelivery } from '../../domain/alert-rule-bell.ts';
import {
  assertPriceEditEventValues,
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
    assertPriceEditEventValues(input);
    if (!(await this.ports.repository.matchesLine(input)))
      throw new Error('PRICE_EDIT_EVENT_INVALID');
    if (!(await this.ports.recipients.companyOpen(input.companyId))) return;
    const { roles, channel } = bellDelivery(
      await this.ports.rules.rule(
        input.companyId,
        { businessId: input.businessId, branchId: input.branchId },
        'SERVICE_LINE_EDITED',
      ),
    );
    const decidedAt = this.clock.now();
    const users = await this.ports.recipients.branchManagerRecipients(input, decidedAt, roles);
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
      {
        nameAr: snapshot.editorNameAr,
        nameEn: snapshot.editorNameEn,
        role: snapshot.editorRole,
        roleIsSystem: snapshot.editorRoleIsSystem,
        roleNameAr: snapshot.editorRoleNameAr,
        roleNameEn: snapshot.editorRoleNameEn,
      },
      this.fallback,
    );
    const branch = await this.ports.place.branchPlace(input);
    // فرع لم يعد موجودًا حالة نهائية لا تصلحها إعادة المحاولة: تُسجَّل كقرار بلا مستلمين
    // مثل «لا مدير في النطاق» فلا يتكرر الحدث ولا يخرج جرس.
    const { groups, recipientCount } = priceEditRecipientGroups(branch === null ? [] : users);
    const won = await this.ports.repository.claim(input, {
      id: this.ids.newId(),
      sourceEventId: input.sourceEventId,
      decidedAt,
      recipientCount,
    });
    // قاعدة مقفولة معناها قناة null وأدوار فاضية، فهي قرار صفر مستلمين زي «لا مدير في النطاق»؛
    // الشرط ده بيحافظ على نوع القناة من غير cast.
    if (!won || branch === null || recipientCount === 0 || channel === null) return;
    await this.publish(input, branch, editor, groups, channel);
  }

  private async publish(
    input: PriceEditNoticeInput,
    branch: Parameters<typeof priceEditNoticeParameters>[0]['branch'],
    editor: PriceEditEditorLabel,
    groups: readonly (readonly string[])[],
    channel: 'IN_APP',
  ): Promise<void> {
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
    for (const group of groups)
      await this.append(input, context.businessTimezone, group, parameters, channel);
  }

  private async append(
    input: PriceEditNoticeInput,
    businessTimezone: string,
    group: readonly string[],
    parameters: PriceEditParameters,
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
