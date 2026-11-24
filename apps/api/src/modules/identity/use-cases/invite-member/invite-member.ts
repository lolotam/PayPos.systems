import type { InviteMemberInput } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { DomainEvent } from '../../../../shared/ports/outbox-writer.port.ts';
import { invitationScopeFailure } from '../../domain/invitable-roles.ts';
import { MEMBER_INVITED, type MemberInvited } from '../../events/published.ts';
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

/** نتيجة الدعوة: الرابط بيتسلّم مرة واحدة، و null لما الدعوة كانت اكتملت قبل كده. */
export interface InviteMemberResult {
  readonly invitation_id: string;
  readonly set_password_link: string | null;
}

/** خطوة ما قبل الكتابة: الحدّ، وإيميل الموظفة، والدور والنطاق، والدعوة الذاتية، وحساب موجود (N1). */
async function assertInvitable(
  limiter: InvitationRateLimiter,
  accounts: MemberAccounts,
  command: InviteMemberCommand,
): Promise<void> {
  const { actor, input } = command;
  if (!(await limiter.allow(actor.userId))) throw new ApiError('TOO_MANY_REQUESTS');
  if (accounts.isStaffEmail(input.email)) throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
  const scopeFailure = invitationScopeFailure(input.role, input.scope.type);
  if (scopeFailure !== null) throw new ApiError(scopeFailure);
  // قرار N1: أي إيميل له حساب موجود بيترفض برسالة عامة — مفيش عضوية بتتضاف لحساب قائم،
  // وكمان بيغطي الدعوة الذاتية لأن إيميل المالك نفسه حساب موجود.
  const existing = await accounts.findByEmail(input.email);
  if (existing !== null) throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
}

/** حدث MemberInvited من الصف المقفول: معرّفات الحالة والدور بس — مفيش إيميل ولا رابط ولا token. */
function invitedEvent(
  row: { id: string; roleCode: string; scopeType: string; scopeId: string; invitedBy: string },
  membershipId: string,
  userId: string,
): DomainEvent {
  const payload: MemberInvited = {
    invitation_id: row.id,
    user_id: userId,
    membership_id: membershipId,
    role_code: row.roleCode,
    scope_type: row.scopeType,
    scope_id: row.scopeId,
    invited_by: row.invitedBy,
  };
  return {
    aggregateType: 'member_invitation',
    aggregateId: row.id,
    eventType: MEMBER_INVITED,
    payload,
  };
}

/** صفوف التدقيق من الصف المقفول: إنشاء الحساب، ثم العضوية — بالترتيب اللي بتكتب بيه. */
function auditEntries(
  row: { id: string; invitedBy: string; roleCode: string; scopeType: string; scopeId: string },
  membershipId: string,
  userId: string,
) {
  return [
    {
      entity: 'member_invitation',
      entityId: row.id,
      action: 'user.created',
      after: { user_id: userId, invitation_id: row.id },
    },
    {
      entity: 'membership',
      entityId: membershipId,
      action: 'created',
      after: {
        membership_id: membershipId,
        user_id: userId,
        role_code: row.roleCode,
        scope_type: row.scopeType,
        scope_id: row.scopeId,
      },
    },
  ];
}

/**
 * بيدعو عضو للشركة (G1): أربع خطوات — صف الدعوة، ثم الحساب الجديد، ثم العضوية والتدقيق
 * والحدث، ثم رابط تعيين كلمة المرور. الحساب على pospay_auth والصفوف على pospay_app، فمفيش
 * معاملة واحدة تجمعهم؛ الاستئناف بيتم بمعرف الدعوة (D6)، وإيميل له حساب بيترفض (N1).
 */
export class InviteMember {
  readonly #transactions: MemberInvitationTransactions;
  readonly #accounts: MemberAccounts;
  readonly #limiter: InvitationRateLimiter;
  readonly #invalidator: GrantInvalidator;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #redirectTo: string;
  readonly #linkLifetimeMs: number;

  constructor(options: {
    transactions: MemberInvitationTransactions;
    accounts: MemberAccounts;
    limiter: InvitationRateLimiter;
    invalidator: GrantInvalidator;
    clock: Clock;
    ids: IdGenerator;
    redirectTo: string;
    /** عمر رابط الدعوة بالمللي ثانية (IM-Q3: 48 ساعة) — من التركيب، مش ثابت في الـ use case. */
    linkLifetimeMs: number;
  }) {
    this.#transactions = options.transactions;
    this.#accounts = options.accounts;
    this.#limiter = options.limiter;
    this.#invalidator = options.invalidator;
    this.#clock = options.clock;
    this.#ids = options.ids;
    this.#redirectTo = options.redirectTo;
    this.#linkLifetimeMs = options.linkLifetimeMs;
  }

  /**
   * @param command الفاعل والمدخلات المتحققة
   * @returns معرف الدعوة والرابط، أو null لما الدعوة كانت اكتملت قبل كده والرابط اتعرض
   */
  async execute(command: InviteMemberCommand): Promise<InviteMemberResult> {
    const { actor, input } = command;
    await assertInvitable(this.#limiter, this.#accounts, command);
    const now = this.#clock.now();
    const scope = { type: input.scope.type, id: input.scope.id };
    const opened = await this.#transactions.open({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      invitationId: this.#ids.newId(),
      emailHash: this.#accounts.hashEmail(input.email),
      roleCode: input.role,
      scope,
      now,
    });
    if ('refusal' in opened) throw new ApiError(opened.refusal);
    const account = await this.#accounts.createInvitedMember({
      operationId: opened.invitationId,
      companyId: actor.companyId,
      email: input.email,
      name: input.name,
    });
    // قرار N1: لو الإيميل سبق له حساب (اتعمل في سباق أو بين شركتين) الطلب بيرفض 422.
    if (!account.createdByInvitation) throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
    const membershipId = this.#ids.newId();
    const outcome = await this.#transactions.complete({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      invitationId: opened.invitationId,
      membershipId,
      userId: account.userId,
      buildEvent: (row, id, userId) => invitedEvent(row, id, userId),
      buildAudit: (row, id, userId) => auditEntries(row, id, userId),
      now,
    });
    if (!outcome.done) throw new ApiError(outcome.refusal);
    const link = await this.#issueLinkIfNeeded(
      account,
      actor.companyId,
      actor.userId,
      opened.invitationId,
      now,
    );
    if (!outcome.alreadyComplete) {
      await this.#invalidator.invalidate(actor.companyId, outcome.membershipId);
    }
    return { invitation_id: opened.invitationId, set_password_link: link };
  }

  /** الرابط مرة واحدة: حجز ذري بيمنع سباق ملكين، والإصدار بيجي بعد الحجز بس. */
  async #issueLinkIfNeeded(
    account: { userId: string },
    companyId: string,
    actorUserId: string,
    invitationId: string,
    now: Date,
  ): Promise<string | null> {
    const claimed = await this.#transactions.claimLink({ companyId, invitationId, at: now });
    if (!claimed) return null;
    const link = await this.#accounts.issueLink({
      userId: account.userId,
      companyId,
      redirectTo: this.#redirectTo,
      lifetimeMs: this.#linkLifetimeMs,
      now,
    });
    await this.#transactions.stampLink({ companyId, invitationId, actorUserId, at: now });
    return link;
  }
}
