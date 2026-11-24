import type { InviteMemberInput } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { DomainEvent } from '../../../../shared/ports/outbox-writer.port.ts';
import { invitationScopeFailure } from '../../domain/invitable-roles.ts';
import { MEMBER_INVITED, type MemberInvited } from '../../events/published.ts';
import {
  MemberLinkRefusedError,
  type InvitationActor,
  type InvitationRateLimiter,
  type MemberAccounts,
  type MemberInvitationRow,
  type MemberInvitationTransactions,
} from '../../ports/member-invitations.port.ts';
import type { GrantInvalidator } from '../../ports/permission-overrides.port.ts';

export interface InviteMemberCommand {
  readonly actor: { readonly companyId: string; readonly userId: string };
  readonly input: InviteMemberInput;
}

/** نتيجة الدعوة: الرابط بيتسلّم مرة واحدة، ولا بيرجع تاني من أي مسار (N1). */
export interface InviteMemberResult {
  readonly invitation_id: string;
  readonly set_password_link: string;
}

/** حدث MemberInvited من الصف المقفول: معرّفات الحالة والدور بس — مفيش إيميل ولا رابط ولا token. */
function invitedEvent(row: MemberInvitationRow, membershipId: string, userId: string): DomainEvent {
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
function auditEntries(row: MemberInvitationRow, membershipId: string, userId: string) {
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
 * بيدعو عضو جديد للشركة (G1): فحص السلطة، ثم رفض أي إيميل له حساب (N1)، ثم صف الدعوة، ثم
 * الحساب الجديد، ثم العضوية والتدقيق والحدث، ثم رابط تعيين كلمة المرور مرة واحدة. الحساب
 * على pospay_auth والصفوف على pospay_app، فمفيش معاملة واحدة؛ الاستئناف بمعرّف الدعوة (D6).
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
   * @returns معرف الدعوة والرابط (مرة واحدة)
   */
  async execute(command: InviteMemberCommand): Promise<InviteMemberResult> {
    const { actor, input } = command;
    const who = { companyId: actor.companyId, actorUserId: actor.userId };
    if (!(await this.#limiter.allow(actor.userId))) throw new ApiError('TOO_MANY_REQUESTS');
    const scopeFailure = invitationScopeFailure(input.role, input.scope.type);
    if (scopeFailure !== null) throw new ApiError(scopeFailure);
    const scope = { type: input.scope.type, id: input.scope.id };
    const denied = await this.#transactions.authorize({ ...who, scope });
    if (denied !== null) throw new ApiError(denied);
    const email = this.#accounts.isStaffEmail(input.email)
      ? { kind: 'TAKEN' as const }
      : await this.#accounts.inspectEmail(input.email, actor.companyId);
    if (email.kind === 'TAKEN') await this.#refuseEmail(who);
    const now = this.#clock.now();
    const opened = await this.#transactions.open({
      ...who,
      invitationId: this.#ids.newId(),
      emailHash: this.#accounts.hashEmail(input.email),
      roleCode: input.role,
      scope,
      now,
    });
    if ('refusal' in opened) throw new ApiError(opened.refusal);
    if (email.kind === 'OURS' && email.operationId !== opened.invitationId) {
      await this.#refuseEmail(who);
    }
    const account = await this.#accounts.createInvitedMember({
      operationId: opened.invitationId,
      companyId: actor.companyId,
      email: input.email,
      name: input.name,
    });
    if (!account.createdByInvitation) {
      // خسرنا سباق إنشاء الحساب لصالح حساب بنفس الإيميل: الدعوة اللي فتحناها بتتلغى (N1).
      await this.#transactions.cancelOpened({ ...who, invitationId: opened.invitationId });
      throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
    }
    const outcome = await this.#transactions.complete({
      ...who,
      invitationId: opened.invitationId,
      membershipId: this.#ids.newId(),
      userId: account.userId,
      buildEvent: invitedEvent,
      buildAudit: auditEntries,
      now,
    });
    if (!outcome.done) throw new ApiError(outcome.refusal);
    const link = await this.#issueLink(account.userId, who, opened.invitationId, now);
    if (!outcome.alreadyComplete) {
      await this.#invalidator.invalidate(actor.companyId, outcome.membershipId);
    }
    return { invitation_id: opened.invitationId, set_password_link: link };
  }

  /** رفض إيميل له حساب: تدقيق من غير الإيميل، ورد 422 عام (N1). */
  async #refuseEmail(who: InvitationActor): Promise<never> {
    await this.#transactions.recordRefusal(who);
    throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
  }

  /**
   * الرابط مرة واحدة: حجز ذري يمنع سباق طلبين، والإصدار بيجي بعد الحجز، والختم بعد كتابة
   * التوكن بس. دعوة رابطها اتحجز قبل كده بترد 409 وتحيل المالك لإعادة الإصدار.
   */
  async #issueLink(
    userId: string,
    who: InvitationActor,
    invitationId: string,
    now: Date,
  ): Promise<string> {
    const claimed = await this.#transactions.claimLink({
      companyId: who.companyId,
      invitationId,
      at: now,
    });
    if (!claimed) throw new ApiError('MEMBER_INVITATION_EXISTS');
    let link: string;
    try {
      link = await this.#accounts.issueLink({
        userId,
        companyId: who.companyId,
        redirectTo: this.#redirectTo,
        lifetimeMs: this.#linkLifetimeMs,
        now,
      });
    } catch (error) {
      if (error instanceof MemberLinkRefusedError) throw new ApiError('MEMBER_INVITATION_EXISTS');
      throw error;
    }
    await this.#transactions.stampLink({ ...who, invitationId, at: now });
    return link;
  }
}
