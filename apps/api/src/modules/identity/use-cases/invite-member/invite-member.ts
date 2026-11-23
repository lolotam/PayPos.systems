import { isStaffSyntheticEmail, MEMBER_INVITATION_LINK_TTL_MS } from '@pospay/auth';
import type { InviteMemberInput } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { invitationScopeFailure } from '../../domain/invitable-roles.ts';
import type {
  InvitationRateLimiter,
  MemberAccounts,
  MemberInvitationTransactions,
} from '../../ports/member-invitations.port.ts';
import type { GrantInvalidator } from '../../ports/permission-overrides.port.ts';

export interface InviteMemberCommand {
  readonly actor: { readonly companyId: string; readonly userId: string };
  readonly input: InviteMemberInput;
}

/** نتيجة الدعوة: الرابط بيتسلّم مرة واحدة، و null لما كان للحساب حساب موجود. */
export interface InviteMemberResult {
  readonly invitation_id: string;
  readonly set_password_link: string | null;
}

/**
 * بيدعو عضو للشركة (G1): أربع خطوات — صف الدعوة، ثم الحساب، ثم العضوية والتدقيق والحدث،
 * ثم رابط تعيين كلمة المرور. الحساب على pospay_auth والصفوف على pospay_app، فمفيش معاملة
 * واحدة تجمعهم؛ الاستئناف بيتم بمعرف الدعوة (D6).
 */
export class InviteMember {
  readonly #transactions: MemberInvitationTransactions;
  readonly #accounts: MemberAccounts;
  readonly #limiter: InvitationRateLimiter;
  readonly #invalidator: GrantInvalidator;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #redirectTo: string;

  constructor(options: {
    transactions: MemberInvitationTransactions;
    accounts: MemberAccounts;
    limiter: InvitationRateLimiter;
    invalidator: GrantInvalidator;
    clock: Clock;
    ids: IdGenerator;
    redirectTo: string;
  }) {
    this.#transactions = options.transactions;
    this.#accounts = options.accounts;
    this.#limiter = options.limiter;
    this.#invalidator = options.invalidator;
    this.#clock = options.clock;
    this.#ids = options.ids;
    this.#redirectTo = options.redirectTo;
  }

  /**
   * @param command الفاعل والمدخلات المتحققة
   * @returns معرف الدعوة والرابط، أو null لما كان للحساب حساب موجود
   */
  async execute(command: InviteMemberCommand): Promise<InviteMemberResult> {
    const { actor, input } = command;
    if (!(await this.#limiter.allow(actor.userId))) throw new ApiError('TOO_MANY_REQUESTS');
    if (isStaffSyntheticEmail(input.email)) throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
    const scopeFailure = invitationScopeFailure(input.role, input.scope.type);
    if (scopeFailure !== null) throw new ApiError(scopeFailure);
    // الحساب موجود بالإيميل: لو ده اليوزر نفسه فالمالك مش بيدعو نفسه.
    const existing = await this.#accounts.findByEmail(input.email);
    if (existing !== null && existing.userId === actor.userId) {
      throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
    }
    const invitationId = this.#ids.newId();
    const now = this.#clock.now();
    const scope = { type: input.scope.type, id: input.scope.id };
    await this.#transactions.open({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      invitationId,
      emailHash: this.#accounts.hashEmail(input.email),
      roleCode: input.role,
      scope,
      existingUserId: existing?.userId ?? null,
      now,
    });
    const account = await this.#accounts.createInvitedMember({
      operationId: invitationId,
      companyId: actor.companyId,
      email: input.email,
      name: input.name,
    });
    const membershipId = this.#ids.newId();
    const outcome = await this.#transactions.complete({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      invitationId,
      userId: account.userId,
      membershipId,
      roleCode: input.role,
      scope,
      createdByInvitation: account.createdByInvitation,
      now,
    });
    if (!outcome.ok) throw new ApiError('MEMBER_ALREADY_IN_COMPANY');
    let link: string | null = null;
    if (account.createdByInvitation) {
      link = await this.#accounts.issueInvitationLink({
        userId: account.userId,
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
    }
    await this.#invalidator.invalidate(actor.companyId, membershipId);
    return { invitation_id: invitationId, set_password_link: link };
  }
}
