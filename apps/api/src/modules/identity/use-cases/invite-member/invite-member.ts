import { isStaffSyntheticEmail, MEMBER_INVITATION_LINK_TTL_MS } from '@pospay/auth';
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

/** نتيجة الدعوة: الرابط بيتسلّم مرة واحدة، و null لما كان للحساب حساب موجود. */
export interface InviteMemberResult {
  readonly invitation_id: string;
  readonly set_password_link: string | null;
}

/** خطوة ما قبل الكتابة: الحدّ، وإيميل الموظفة، والدور والنطاق، والدعوة الذاتية — كلها بترفض قبل أي كتابة. */
async function assertInvitable(
  limiter: InvitationRateLimiter,
  accounts: MemberAccounts,
  command: InviteMemberCommand,
): Promise<{ userId: string } | null> {
  const { actor, input } = command;
  if (!(await limiter.allow(actor.userId))) throw new ApiError('TOO_MANY_REQUESTS');
  if (isStaffSyntheticEmail(input.email)) throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
  const scopeFailure = invitationScopeFailure(input.role, input.scope.type);
  if (scopeFailure !== null) throw new ApiError(scopeFailure);
  // الحساب موجود بالإيميل: لو ده اليوزر نفسه فالمالك مش بيدعو نفسه.
  const existing = await accounts.findByEmail(input.email);
  if (existing !== null && existing.userId === actor.userId) {
    throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
  }
  return existing;
}

/** صفوف التدقيق: إنشاء الحساب للمدعوّ الجديد، ثم العضوية — بالترتيب اللي بتكتب بيه. */
function auditEntries(
  invitationId: string,
  userId: string,
  membershipId: string,
  roleCode: string,
  scope: { type: string; id: string },
  createdByInvitation: boolean,
) {
  const membership = {
    entity: 'membership',
    entityId: membershipId,
    action: 'created',
    after: {
      membership_id: membershipId,
      user_id: userId,
      role_code: roleCode,
      scope_type: scope.type,
      scope_id: scope.id,
    },
  };
  if (!createdByInvitation) return [membership];
  return [
    {
      entity: 'member_invitation',
      entityId: invitationId,
      action: 'user.created',
      after: { user_id: userId, invitation_id: invitationId },
    },
    membership,
  ];
}

/** حدث MemberInvited: معرّفات الحالة والدور بس — مفيش إيميل ولا رابط ولا token في الـ payload. */
function invitedEvent(
  invitationId: string,
  userId: string,
  membershipId: string,
  role: { roleCode: string; scope: { type: string; id: string }; invitedBy: string },
): DomainEvent {
  const payload: MemberInvited = {
    invitation_id: invitationId,
    user_id: userId,
    membership_id: membershipId,
    role_code: role.roleCode,
    scope_type: role.scope.type,
    scope_id: role.scope.id,
    invited_by: role.invitedBy,
  };
  return {
    aggregateType: 'member_invitation',
    aggregateId: invitationId,
    eventType: MEMBER_INVITED,
    payload,
  };
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
    const existing = await assertInvitable(this.#limiter, this.#accounts, command);
    const now = this.#clock.now();
    const scope = { type: input.scope.type, id: input.scope.id };
    const opened = await this.#transactions.open({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      invitationId: this.#ids.newId(),
      emailHash: this.#accounts.hashEmail(input.email),
      roleCode: input.role,
      scope,
      existingUserId: existing?.userId ?? null,
      now,
    });
    if ('refusal' in opened) throw new ApiError(opened.refusal);
    const account = await this.#accounts.createInvitedMember({
      operationId: opened.invitationId,
      companyId: actor.companyId,
      email: input.email,
      name: input.name,
    });
    const membershipId = this.#ids.newId();
    const outcome = await this.#transactions.complete({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      invitationId: opened.invitationId,
      userId: account.userId,
      membershipId,
      roleCode: input.role,
      scope,
      createdByInvitation: account.createdByInvitation,
      audit: auditEntries(
        opened.invitationId,
        account.userId,
        membershipId,
        input.role,
        scope,
        account.createdByInvitation,
      ),
      event: invitedEvent(opened.invitationId, account.userId, membershipId, {
        roleCode: input.role,
        scope,
        invitedBy: actor.userId,
      }),
      now,
    });
    if (!outcome.done) throw new ApiError('MEMBER_ALREADY_IN_COMPANY');
    const link = await this.#issueLinkIfNeeded(outcome, account, actor.companyId, opened.invitationId, now);
    if (!outcome.alreadyComplete) {
      await this.#invalidator.invalidate(actor.companyId, membershipId);
    }
    return { invitation_id: opened.invitationId, set_password_link: link };
  }

  /** الرابط مرة واحدة: للمدعوّ الجديد فقط، ولو انقطعنا قبل إصداره بيطلع هنا؛ بعده بيطلع null. */
  async #issueLinkIfNeeded(
    outcome: { linkIssuedAt: Date | null },
    account: { userId: string; createdByInvitation: boolean },
    companyId: string,
    invitationId: string,
    now: Date,
  ): Promise<string | null> {
    if (!account.createdByInvitation || outcome.linkIssuedAt !== null) return null;
    const link = await this.#accounts.issueInvitationLink({
      userId: account.userId,
      companyId,
      redirectTo: this.#redirectTo,
      lifetimeMs: MEMBER_INVITATION_LINK_TTL_MS,
      now,
    });
    await this.#transactions.stampLink({ companyId, invitationId, at: now });
    return link;
  }
}
