import type { InviteMemberInput } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { DomainEvent } from '../../../../shared/ports/outbox-writer.port.ts';
import {
  collectInvitationAssignments,
  type InvitationAssignment,
} from '../../domain/invitable-roles.ts';
import { MEMBER_INVITED, type MemberInvited } from '../../events/published.ts';
import {
  MemberLinkRefusedError,
  type InvitationActor,
  type InvitationRateLimiter,
  type InvitedMembership,
  type MemberAccounts,
  type MemberInvitationRow,
  type MemberInvitationTransactions,
} from '../../ports/member-invitations.port.ts';
import type { GrantInvalidator } from '../../ports/permission-overrides.port.ts';

/** دعوة ما اتكملتش وعدّى عليها الوقت ده بتتحسب عالقة: مفيش طلب شغال فيها، فمالك تاني يقدر يلغيها. */
const STALE_INVITATION_AFTER_MS = 10 * 60 * 1000;

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
function invitedEvent(
  row: MemberInvitationRow,
  membership: InvitedMembership,
  userId: string,
): DomainEvent {
  const payload: MemberInvited = {
    invitation_id: row.id,
    user_id: userId,
    membership_id: membership.membershipId,
    role_code: membership.roleCode,
    scope_type: membership.scopeType,
    scope_id: membership.scopeId,
    invited_by: row.invitedBy,
  };
  return {
    aggregateType: 'member_invitation',
    aggregateId: row.id,
    eventType: MEMBER_INVITED,
    payload,
  };
}

/** صفوف التدقيق من الصف المقفول: إنشاء الحساب، ثم صف عضوية لكل عضوية — بالترتيب اللي بتكتب بيه. */
function auditEntries(
  row: MemberInvitationRow,
  memberships: readonly InvitedMembership[],
  userId: string,
) {
  return [
    {
      entity: 'member_invitation',
      entityId: row.id,
      action: 'user.created',
      after: { user_id: userId, invitation_id: row.id },
    },
    ...memberships.map((membership) => ({
      entity: 'membership',
      entityId: membership.membershipId,
      action: 'created',
      after: {
        membership_id: membership.membershipId,
        user_id: userId,
        role_code: membership.roleCode,
        scope_type: membership.scopeType,
        scope_id: membership.scopeId,
      },
    })),
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
    const collected = collectInvitationAssignments({
      role: input.role,
      scope: input.scope,
      additional_roles: input.additional_roles,
    });
    if (!collected.ok) throw new ApiError(collected.refusal);
    const additionalAssignments = collected.assignments.slice(1);
    // كل النطاقات — الأساسية والإضافية — بتتتفحص قبل أي قراءة عن الإيميل، عشان رد «له حساب» ما يتسربش.
    const denied = await this.#transactions.authorize({
      ...who,
      scope: { type: input.scope.type, id: input.scope.id },
      additionalAssignments,
    });
    if (denied !== null) throw new ApiError(denied);
    const now = this.#clock.now();
    const opened = await this.#open(who, input, additionalAssignments, now);
    const userId = await this.#createAccount(who, opened.invitationId, input);
    const outcome = await this.#transactions.complete({
      ...who,
      invitationId: opened.invitationId,
      membershipId: this.#ids.newId(),
      userId,
      additionalAssignments,
      additionalMembershipIds: additionalAssignments.map(() => this.#ids.newId()),
      permissionOverrides: input.permission_overrides ?? [],
      buildEvent: invitedEvent,
      buildAudit: auditEntries,
      now,
    });
    if (!outcome.done) {
      // الحساب اتعمل لكن الإتمام اترفض: من غير الإلغاء ده الإيميل بيفضل محجوز بحساب من غير عضوية ولا رابط.
      await this.#abandonOwn(who, opened.invitationId);
      throw new ApiError(outcome.refusal);
    }
    const link = await this.#issueLink(userId, who, opened.invitationId, now, input.email);
    if (!outcome.alreadyComplete) {
      for (const membershipId of outcome.membershipIds) {
        await this.#invalidator.invalidate(actor.companyId, membershipId);
      }
    }
    return { invitation_id: opened.invitationId, set_password_link: link };
  }

  /**
   * فتح صف الدعوة: فحص الإيميل، ورفض «له حساب»، وكتابة الصف أو إعادة استخدامه بعد انقطاع.
   *
   * @param who المتصل والشركة
   * @param input الإيميل والاسم والدور من الطلب
   * @param additionalAssignments التوزيعات الإضافية بعد إزالة المكرر
   * @param now وقت الطلب
   * @returns معرّف صف الدعوة المفتوح
   */
  async #open(
    who: InvitationActor,
    input: InviteMemberCommand['input'],
    additionalAssignments: readonly InvitationAssignment[],
    now: Date,
  ): Promise<{ invitationId: string }> {
    const staleBefore = new Date(now.getTime() - STALE_INVITATION_AFTER_MS);
    let email = this.#accounts.isStaffEmail(input.email)
      ? { kind: 'TAKEN' as const }
      : await this.#accounts.inspectEmail(input.email, who.companyId);
    if (email.kind === 'OURS') {
      email = await this.#reclaimAbandoned(who, email, input, staleBefore, additionalAssignments);
    }
    if (email.kind === 'TAKEN') await this.#refuseEmail(who);
    const opened = await this.#transactions.open({
      ...who,
      invitationId: this.#ids.newId(),
      emailHash: this.#accounts.hashEmail(input.email),
      roleCode: input.role,
      scope: { type: input.scope.type, id: input.scope.id },
      additionalAssignments,
      now,
      staleBefore,
      accountOperationId: email.kind === 'OURS' ? email.operationId : undefined,
    });
    if ('refusal' in opened) throw new ApiError(opened.refusal);
    if (email.kind === 'OURS' && email.operationId !== opened.invitationId) {
      await this.#freeDanglingAccount(who, email.operationId, opened.invitationId);
    }
    return opened;
  }

  /** دعوة نفس الطلب اترفض إتمامها: بتتلغى، وحساب عمليتها بيتمسح لما يتأكد إن مفيش عضوية. */
  async #abandonOwn(who: InvitationActor, invitationId: string): Promise<void> {
    if (await this.#transactions.abandonOwn({ ...who, invitationId })) {
      await this.#accounts.discardInvitedMember({
        operationId: invitationId,
        companyId: who.companyId,
      });
    }
  }

  /**
   * حساب المدعوّ: لو سبقنا حساب بنفس الإيميل، الدعوة اللي فتحناها بتتلغى (N1).
   *
   * @param who المتصل والشركة
   * @param invitationId معرّف الدعوة المفتوحة
   * @param input الإيميل والاسم من الطلب
   * @returns معرّف الحساب الجديد
   */
  async #createAccount(
    who: InvitationActor,
    invitationId: string,
    input: InviteMemberCommand['input'],
  ): Promise<string> {
    const account = await this.#accounts.createInvitedMember({
      operationId: invitationId,
      companyId: who.companyId,
      email: input.email,
      name: input.name,
    });
    if (account.createdByInvitation) return account.userId;
    // خسرنا سباق إنشاء الحساب لصالح حساب بنفس الإيميل: الدعوة اللي فتحناها بتتلغى (N1).
    await this.#transactions.cancelOpened({ ...who, invitationId });
    throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
  }

  /**
   * حساب علق من دعوة ماتت (صفها اتلغى أو مفقود): ما ينفعش يتستأنف، فبيتّشال عشان الإيميل يرجع
   * حر والدعوة الجديدة تكمل (AC-ACT-20). لو الحساب له كلمة مرور، الدعوة بترفض زي أي حساب (N1).
   */
  async #freeDanglingAccount(
    who: InvitationActor,
    operationId: string,
    invitationId: string,
  ): Promise<void> {
    const discarded = await this.#accounts.discardInvitedMember({
      operationId,
      companyId: who.companyId,
    });
    if (discarded) return;
    // الحساب مش راح: الدعوة اللي اتفتحت بتتألغى عشان ما تبقاش عالقة على الإيميل.
    await this.#transactions.cancelOpened({ ...who, invitationId });
    await this.#refuseEmail(who);
  }

  /**
   * حساب اتنشأ من دعوة قديمة لنفس الشركة ولسه من غير كلمة مرور: لو دعوته عالقة (ما اتكملتش وخلص
   * وقتها، أو اتلغت ومسح الحساب انقطع) بتتلغى وحسابها بيتمسح، والإيميل بيرجع حر لمالك حالي؛ لو مفيش
   * حاجة تتلغى بيفضل الحال زي ما هو (استئناف أو رفض بالقواعد القديمة).
   */
  async #reclaimAbandoned(
    who: InvitationActor,
    email: { kind: 'OURS'; operationId: string },
    input: InviteMemberCommand['input'],
    staleBefore: Date,
    additionalAssignments: readonly InvitationAssignment[],
  ): Promise<{ kind: 'FREE' } | { kind: 'TAKEN' } | { kind: 'OURS'; operationId: string }> {
    const abandoned = await this.#transactions.abandonStale({
      ...who,
      invitationId: email.operationId,
      roleCode: input.role,
      scope: { type: input.scope.type, id: input.scope.id },
      additionalAssignments,
      staleBefore,
    });
    if (!abandoned) return email;
    const discarded = await this.#accounts.discardInvitedMember({
      operationId: email.operationId,
      companyId: who.companyId,
    });
    return discarded ? { kind: 'FREE' } : { kind: 'TAKEN' };
  }

  /** رفض إيميل له حساب: تدقيق من غير الإيميل، ورد 422 عام (N1). */
  async #refuseEmail(who: InvitationActor): Promise<never> {
    await this.#transactions.recordRefusal(who);
    throw new ApiError('MEMBER_EMAIL_NOT_INVITABLE');
  }

  /**
   * الرابط مرة واحدة: حجز ذري يمنع سباق طلبين، والإصدار بيجي بعد الحجز، والختم بعد كتابة
   * التوكن بس. الحجز بيعيد فحص سلطة المالك جوه معاملته، فلو اتسحبت بين الإتمام والحجز
   * الطلب بيرفض بدل ما الرابط يطلع (AC-ACT-19). دعوة رابطها اتحجز قبل كده بترد 409 وتحيل
   * المالك لإعادة الإصدار.
   */
  async #issueLink(
    userId: string,
    who: InvitationActor,
    invitationId: string,
    now: Date,
    email: string,
  ): Promise<string> {
    const claimed = await this.#transactions.claimLink({
      ...who,
      invitationId,
      at: now,
    });
    if (!claimed.claimed) throw new ApiError(claimed.refusal);
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
    await this.#transactions.stampLink({ ...who, invitationId, at: now, userId, link, email });
    return link;
  }
}
