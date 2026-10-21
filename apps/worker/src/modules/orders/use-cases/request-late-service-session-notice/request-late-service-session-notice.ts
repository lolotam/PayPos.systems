import {
  interimLateNoticeRule,
  qualifiesForLateNotice,
  lateNoticeParameters,
  lateNoticeRecipientGroups,
  type BranchNameFallback,
} from '../../domain/late-service-session-notice.ts';
import type {
  Clock,
  IdGenerator,
  LateNoticePorts,
  LateNoticeSession,
} from '../../ports/late-service-session-notice.port.ts';

/** يطلب جرس الزيارة المتأخرة مرة واحدة لكل مستلم داخل معاملة المستهلك. */
export class RequestLateServiceSessionNotice {
  constructor(
    private readonly ports: LateNoticePorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly fallback: BranchNameFallback,
  ) {}

  async execute(
    input: LateNoticeSession & {
      sourceEventId: string;
      late: boolean;
      lines: readonly { late: boolean }[];
    },
  ): Promise<void> {
    if (!qualifiesForLateNotice(input)) return;
    if (!(await this.ports.repository.matchesSession(input)))
      throw new Error('LATE_SESSION_EVENT_INVALID');
    if (!(await this.ports.recipients.companyOpen(input.companyId))) return;
    const rule = interimLateNoticeRule();
    const decidedAt = this.clock.now();
    const users = await this.ports.recipients.forBranch(input, decidedAt, rule.roles);
    const branch = await this.ports.place.forBranch(input);
    // فرع لم يعد موجودًا حالة نهائية لا تصلحها إعادة المحاولة: تُسجَّل كقرار بلا مستلمين
    // مثل «لا مدير في النطاق» فلا يتكرر الحدث ولا يخرج جرس.
    const { groups, recipientCount } = lateNoticeRecipientGroups(branch === null ? [] : users);
    const won = await this.ports.repository.claim(input, {
      id: this.ids.newId(),
      sourceEventId: input.sourceEventId,
      decidedAt,
      recipientCount,
    });
    if (!won || branch === null || recipientCount === 0) return;
    const parameters = lateNoticeParameters(branch, input.businessDate, this.fallback);
    for (const group of groups)
      await this.ports.outbox.append(this.ids.newId(), {
        schema_version: 1,
        session_id: input.sessionId,
        business_id: input.businessId,
        branch_id: input.branchId,
        business_date: input.businessDate,
        business_timezone: input.businessTimezone,
        notification_recipients: group.map((user_id) => ({
          channel: rule.channel,
          user_id,
          locale: 'ar',
          template_key: 'late_service_session',
          template_revision: 1,
          safe_parameters: parameters,
        })),
      });
  }
}
