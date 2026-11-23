import { InvitationLinkRefusedError, MEMBER_INVITATION_LINK_TTL_MS } from '@pospay/auth';

import { ApiError } from '../../../../shared/errors.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type {
  InvitationRateLimiter,
  MemberAccounts,
  MemberInvitationTransactions,
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
 * بيصدّر رابط جديد لدعوة معلّقة (G1): بس للمالك اللي عمل الدعوة، وبس طول ما العضو ما حطّش
 * كلمة مروره. الرابط القديم بيحبط، واليوزر لازم يكون اتعمل من الدعوة دي.
 */
export class ReissueMemberInvitation {
  readonly #transactions: MemberInvitationTransactions;
  readonly #accounts: MemberAccounts;
  readonly #limiter: InvitationRateLimiter;
  readonly #clock: Clock;
  readonly #redirectTo: string;

  constructor(options: {
    transactions: MemberInvitationTransactions;
    accounts: MemberAccounts;
    limiter: InvitationRateLimiter;
    clock: Clock;
    redirectTo: string;
  }) {
    this.#transactions = options.transactions;
    this.#accounts = options.accounts;
    this.#limiter = options.limiter;
    this.#clock = options.clock;
    this.#redirectTo = options.redirectTo;
  }

  /**
   * @param command الفاعل ومعرف الدعوة
   * @returns الرابط الجديد
   */
  async execute(
    command: ReissueMemberInvitationCommand,
  ): Promise<ReissueMemberInvitationResult> {
    const { actor, invitationId } = command;
    if (!(await this.#limiter.allow(actor.userId))) throw new ApiError('TOO_MANY_REQUESTS');
    const invitation = await this.#transactions.read({
      companyId: actor.companyId,
      invitationId,
    });
    if (invitation === null) throw new ApiError('NOT_FOUND');
    if (invitation.invitedBy !== actor.userId) throw new ApiError('FORBIDDEN');
    if (invitation.state !== 'PENDING') throw new ApiError('MEMBER_INVITATION_NOT_REISSUEABLE');
    const userId = await this.#findInvitedUser(invitationId, actor.companyId);
    if (userId === null) throw new ApiError('MEMBER_INVITATION_NOT_REISSUEABLE');
    const now = this.#clock.now();
    try {
      const link = await this.#accounts.issueInvitationLink({
        userId,
        companyId: actor.companyId,
        redirectTo: this.#redirectTo,
        lifetimeMs: MEMBER_INVITATION_LINK_TTL_MS,
        now,
      });
      await this.#transactions.stampLink({
        companyId: actor.companyId,
        invitationId,
        at: now,
      });
      return { invitation_id: invitationId, set_password_link: link };
    } catch (error) {
      if (error instanceof InvitationLinkRefusedError) {
        throw new ApiError('MEMBER_INVITATION_NOT_REISSUEABLE');
      }
      throw error;
    }
  }

  /** اليوزر اللي اتعمل من الدعوة دي — بالعلامة على جدول الهوية، مش من صف الدعوة. */
  async #findInvitedUser(invitationId: string, companyId: string): Promise<string | null> {
    const found = await this.#accounts.findByInvitation(invitationId, companyId);
    return found?.userId ?? null;
  }
}
