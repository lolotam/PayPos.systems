import { ApiError } from '../../../../shared/errors.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import {
  MemberLinkRefusedError,
  type InvitationRateLimiter,
  type MemberAccounts,
  type MemberInvitationTransactions,
} from '../../ports/member-invitations.port.ts';

export interface ReissueMemberInvitationCommand {
  readonly actor: { readonly companyId: string; readonly userId: string };
  readonly invitationId: string;
}

/** نتيجة إعادة إصدار الرابط: الرابط الجديد بيتسلّم مرة واحدة. */
export interface ReissueMemberInvitationResult {
  readonly invitation_id: string;
  readonly set_password_link: string;
}

/**
 * بيصدّر رابط جديد لدعوة معلّقة (G1): السلطة والنطاق وحالة الدعوة والعضوية بيتفحصوا جوه
 * معاملة قافلة الصف (P1-a)، وفحص «عمري ما حطيت كلمة مروري» بيحصل تحت قفل صف اليوزر وحسابه
 * في نفس معاملة الكتابة (P1-c)، فإصداران متزامنان بيسيبوا توكن حي واحد بس. وقت الإصدار
 * بيتختم بعد كتابة التوكن بس (P2-a).
 */
export class ReissueMemberInvitation {
  readonly #transactions: MemberInvitationTransactions;
  readonly #accounts: MemberAccounts;
  readonly #limiter: InvitationRateLimiter;
  readonly #clock: Clock;
  readonly #redirectTo: string;
  readonly #linkLifetimeMs: number;

  constructor(options: {
    transactions: MemberInvitationTransactions;
    accounts: MemberAccounts;
    limiter: InvitationRateLimiter;
    clock: Clock;
    redirectTo: string;
    /** عمر رابط الدعوة بالمللي ثانية (IM-Q3: 48 ساعة) — من التركيب. */
    linkLifetimeMs: number;
  }) {
    this.#transactions = options.transactions;
    this.#accounts = options.accounts;
    this.#limiter = options.limiter;
    this.#clock = options.clock;
    this.#redirectTo = options.redirectTo;
    this.#linkLifetimeMs = options.linkLifetimeMs;
  }

  /**
   * @param command الفاعل ومعرف الدعوة
   * @returns الرابط الجديد
   */
  async execute(command: ReissueMemberInvitationCommand): Promise<ReissueMemberInvitationResult> {
    const { actor, invitationId } = command;
    if (!(await this.#limiter.allow(actor.userId))) throw new ApiError('TOO_MANY_REQUESTS');
    const now = this.#clock.now();
    const who = { companyId: actor.companyId, actorUserId: actor.userId };
    const claimed = await this.#transactions.claimReissue({ ...who, invitationId });
    if ('refusal' in claimed) throw new ApiError(claimed.refusal);
    let link: string;
    try {
      link = await this.#accounts.issueLink({
        userId: claimed.userId,
        companyId: actor.companyId,
        redirectTo: this.#redirectTo,
        lifetimeMs: this.#linkLifetimeMs,
        now,
      });
    } catch (error) {
      if (error instanceof MemberLinkRefusedError) {
        throw new ApiError('MEMBER_INVITATION_NOT_REISSUEABLE');
      }
      throw error;
    }
    await this.#transactions.stampLink({
      ...who,
      invitationId,
      at: now,
      userId: claimed.userId,
      link,
    });
    return { invitation_id: invitationId, set_password_link: link };
  }
}
