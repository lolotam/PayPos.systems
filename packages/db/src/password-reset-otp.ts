import { and, eq, like, sql } from 'drizzle-orm';
import {
  authOtpChallenges as challenges,
  authNotificationAttempts as attempts,
} from '../schema/identity-staff-otp.ts';
import { account, session, user, verification } from '../schema/identity-auth.ts';
import type { OtpRuntime } from './staff-otp-runtime.ts';
import type { OtpChallengeRecord, OtpContext } from './staff-otp-types.ts';
import type { Tx } from './with-tenant.ts';
import {
  lockedChallenge,
  MAX_FAILED_ATTEMPTS,
  passwordResetScope,
  verifyOtpChallenge,
  type PasswordResetCheck,
} from './otp-challenge-verify.ts';

export type { PasswordResetCheck };

/** بادئة identifier لروابط تعيين كلمة المرور — نفس الشكل اللي Better Auth بيقراه. */
const RESET_LINK_PREFIX = 'reset-password:';

/** حساب اعتماد: هوية بريد وكلمة مرور، مش حساب موظف. */
export interface CredentialUser {
  readonly id: string;
  readonly email: string;
  readonly staffAccessOperationId: string | null;
}

/** تحضير اعتماد استرجاع بالإيميل: صف الاعتماد وصف المحاولة في معاملة واحدة. */
export interface EmailResetPreparation {
  readonly challengeId: string;
  readonly attemptId: string;
  readonly recipientHash: Uint8Array;
  readonly hashKeyId: string;
  readonly userId: string | null;
  readonly locale: 'ar' | 'en';
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly preparationDeadline: Date;
  /** معرّفا مفتاح الاشتقاق والتحقق — بيتخزّنوا مع الاعتماد. */
  readonly derivationKeyId: string;
  readonly verificationKeyId: string;
  /** هل اليوزر مؤهّل أصلاً لاستعادة كلمة المرور. */
  readonly eligible: boolean;
  readonly auditId: string;
  /** سياق الاسترجاع بالرقم السري للموظف؛ غيابه معناه استرجاع كلمة المرور. */
  readonly staffPin?: {
    readonly context: Extract<OtpContext, { purpose: 'STAFF_PIN_RESET' }>;
    /** اسم قالب المزوّد للواتساب فقط؛ الإيميل بلا اسم قالب. */
    readonly providerTemplateName: string | null;
  };
  /** لا يحسب البصمة قبل فوز فحص الحظر داخل القفل. */
  materializeMac(): Buffer;
}

/** نتيجة تحضير الاعتماد: مُجهَّز أو محظور أو مرفوض قبل أي كتابة. */
export type EmailResetPreparationResult = 'PREPARED' | 'SUPPRESSED' | 'REFUSED';

/** استهلاك الاعتماد: كلمة المرور الجديدة مُحسوبة بره المعاملة. */
export interface PasswordResetConsumption {
  readonly challengeId: string;
  /** hash كلمة المرور الجديدة — بيتحسب بره المعاملة، والقفل ما بيستناش. */
  readonly passwordHash: string;
  /** معرّف صف حساب الدخول لو اليوزر مالوش صف. */
  readonly accountId: string;
  readonly auditId: string;
  /** مقارنة ثابتة الزمن لبصمة الاعتماد. */
  compare: (challenge: OtpChallengeRecord) => boolean;
  /** بوصمة الإيميل الحالية لليوزر — لازم تطابق بصمة الاعتماد. */
  identify: (email: string) => Uint8Array;
}

/** نتيجة الاستهلاك الذري: تم التغيير أو مرفوض. */
export type PasswordResetOutcome = 'RESET' | 'INVALID';

/**
 * قاعدة الاعتماد العام للإيميل: ما ينفعش حساب موظف يستعيد كلمة مرور.
 * القرار بياخد القفل عشان الحساب ما يتحولش لموظف في نص العملية.
 */
export type CredentialAccountRule = (
  email: string,
  staffAccessOperationId: string | null,
) => boolean;

/**
 * حدود استرجاع كلمة المرور بالإيميل على pospay_auth: كل SQL هنا، ومفيش عميل خام ولا شركة.
 */
export interface PasswordResetOtpQueries {
  /**
   * يبحث عن حساب بالإيميل المطبّع (lowercase). حساب الموظف بيتعرف من `staffAccessOperationId`،
   * والمستدعي هو اللي بيقرر الأهلية.
   *
   * @param email الإيميل المطبّع بالكامل
   * @param deadline موعد النافذة الثابتة: القراءة بتتحدد بيه عشان ما تطوّلش الردّ الموحّد
   */
  lookupCredentialUserByEmail(email: string, deadline?: Date): Promise<CredentialUser | null>;
  /**
   * يجهّز الاعتماد والمحاولة في معاملة واحدة تحت قفل المستلم: يفحص الحظر العام للإيميل، ويبطل
   * الاعتمادات القديمة النشطة لنفس المستلم، ويكتب الصفوف الجديدة. الحساب غير المؤهل أو
   * المحظور بيترجع من غير أي صف جاهز للإرسال.
   */
  prepareEmailResetChallenge(input: EmailResetPreparation): Promise<EmailResetPreparationResult>;
  /**
   * يفحص الكود على الاعتماد النشط غير المنتهي: خطأ كود واحد بيزوّد المحاولات الفاشلة، والخامسة
   * بتنهي الاعتماد وبتمسح البصمة. الكتابة (تغيير كلمة المرور) مش من هنا. بيشتغل على اعتماد
   * `PASSWORD_RESET` بس: اعتماد موظف بمعرّفه ما يزوّدش عدّاده من هنا. الترتيب ثابت: الفحص هنا
   * دايماً قبل `consumePasswordResetOtp`، والاستهلاك بيعيد المقارنة تحت قفل الصف عشان سباق
   * طلبين متوازيين ما يعدّيش الكود مرتين.
   */
  verifyPasswordResetOtp(
    challengeId: string,
    compare: (challenge: OtpChallengeRecord) => boolean,
    auditId: string,
    deadline?: Date,
  ): Promise<PasswordResetCheck>;
  /**
   * الاستهلاك الذري: قفل المستلم وصف الاعتماد وصف اليوزر في معاملة واحدة، ثم كتابة كلمة المرور
   * وحذف الجلسات وروابط التعيين. أي فشل بيرجّع المعاملة كلها. المقارنة هنا مش بتزوّد المحاولات
   * الفاشلة: عدّاد الخطأ بيتزوّد من `verifyPasswordResetOtp` بس، وبيتشغّل قبل الاستهلاك دايماً.
   */
  consumePasswordResetOtp(input: PasswordResetConsumption): Promise<PasswordResetOutcome>;
}

/** يقرأ حساب الاعتماد بالإيميل المطبّع — الفهرس الفريد على `user.email` بيخدم المطابقة. */
const lookupCredentialUser = (
  runtime: OtpRuntime,
  email: string,
  deadline?: Date,
): Promise<CredentialUser | null> =>
  runtime.run(async (tx) => {
    const [found] = await tx
      .select({
        id: user.id,
        email: user.email,
        staffAccessOperationId: user.staffAccessOperationId,
      })
      .from(user)
      .where(eq(user.email, email));
    return found ?? null;
  }, deadline);

/** صف الاعتماد وصف المحاولة: المحظور بيتسجل منتهي من غير كود ولا مستخدم ولا إرسال. */
async function insertResetRows(
  tx: Tx,
  input: EmailResetPreparation,
  blocked: boolean,
  now: Date,
): Promise<void> {
  const owner = blocked ? null : input.userId;
  await tx.insert(challenges).values({
    id: input.challengeId,
    recipientHash: Buffer.from(input.recipientHash),
    hashKeyId: input.hashKeyId,
    userId: owner,
    deviceContext: (input.staffPin?.context ?? { purpose: 'PASSWORD_RESET' }) satisfies OtpContext,
    codeMac: blocked ? null : input.materializeMac(),
    derivationKeyId: blocked ? null : input.derivationKeyId,
    verificationKeyId: blocked ? null : input.verificationKeyId,
    status: blocked ? 'SUPPRESSED' : 'ACTIVE',
    failedAttempts: 0,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    consumedAt: null,
    finishedAt: blocked ? now : null,
    updatedAt: now,
  });
  await tx.insert(attempts).values({
    id: input.attemptId,
    challengeId: input.challengeId,
    recipientHash: Buffer.from(input.recipientHash),
    hashKeyId: input.hashKeyId,
    userId: owner,
    channel: input.staffPin?.context.channel ?? 'EMAIL',
    templateKey: input.staffPin === undefined ? 'password_reset_otp' : 'staff_pin_reset_otp',
    templateRevision: 1,
    locale: input.locale,
    providerTemplateName: input.staffPin?.providerTemplateName ?? null,
    status: blocked ? 'SUPPRESSED' : 'PREPARED',
    authorizedAt: null,
    sendDeadline: input.expiresAt,
    preparationDeadline: input.preparationDeadline,
    executionId: null,
    sendingAt: null,
    finishedAt: blocked ? now : null,
    failureCode: null,
    outcomeKnown: null,
    providerMessageDigest: null,
    createdAt: input.createdAt,
    updatedAt: now,
  });
}

/** يجهّز الاعتماد تحت قفل المستلم: الحظر أولاً، ثم إبطال القديم، ثم الصفوف الجديدة. */
const prepareEmailReset = async (
  runtime: OtpRuntime,
  input: EmailResetPreparation,
): Promise<EmailResetPreparationResult> =>
  runtime.run(async (tx) => {
    const now = await runtime.lock(tx, input.recipientHash);
    if (now >= input.preparationDeadline) return 'REFUSED';
    const blocked = await runtime.suppressed(
      tx,
      input.recipientHash,
      input.staffPin?.context.channel ?? 'EMAIL',
    );
    if (!blocked && !input.eligible) return 'REFUSED';
    // الاعتماد الجديد يبطل القديم في نفس الغرض والشركة بس: طلب على غرض تاني ما يبطلش التاني (GR-002).
    const samePurpose =
      input.staffPin === undefined
        ? sql`${challenges.deviceContext}->>'purpose' = 'PASSWORD_RESET'`
        : sql`${challenges.deviceContext}->>'purpose' = 'STAFF_PIN_RESET' AND ${challenges.deviceContext}->>'companyId' = ${input.staffPin.context.companyId}`;
    await tx
      .update(challenges)
      .set({ status: 'SUPERSEDED', codeMac: null, finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(challenges.recipientHash, Buffer.from(input.recipientHash)),
          eq(challenges.status, 'ACTIVE'),
          samePurpose,
        ),
      );
    await insertResetRows(tx, input, blocked, now);
    await tx.execute(sql`INSERT INTO platform_audit_log(id,actor,action,target_user_id,details)
        VALUES(${input.auditId},${input.userId ?? 'anonymous'},${input.staffPin === undefined ? 'reset.requested' : 'staffpin.reset_requested'},${input.userId},'{}'::jsonb)`);
    return blocked ? 'SUPPRESSED' : 'PREPARED';
  }, input.preparationDeadline);

/** الاستهلاك الذري: كلمة المرور والجلسات وروابط التعيين في معاملة واحدة. */
const consumePasswordReset = async (
  runtime: OtpRuntime,
  rule: CredentialAccountRule,
  input: PasswordResetConsumption,
): Promise<PasswordResetOutcome> =>
  runtime.run(async (tx) => {
    const found = await lockedChallenge(runtime, tx, input.challengeId);
    if (found === null) return 'INVALID';
    const row = found.challenge;
    if (row.status !== 'ACTIVE' || row.userId === null) return 'INVALID';
    if (found.now >= row.expiresAt) {
      await tx
        .update(challenges)
        .set({ status: 'EXPIRED', codeMac: null, finishedAt: found.now, updatedAt: found.now })
        .where(and(eq(challenges.id, input.challengeId), eq(challenges.status, 'ACTIVE')));
      return 'INVALID';
    }
    if (row.failedAttempts >= MAX_FAILED_ATTEMPTS) return 'INVALID';
    if ((row.deviceContext as { purpose?: string }).purpose !== 'PASSWORD_RESET') return 'INVALID';
    // قفل صف اليوزر بعد قفل الاعتماد: نفس الترتيب في كل الكتابات على الهوية.
    const [owner] = await tx
      .select({
        id: user.id,
        email: user.email,
        staffAccessOperationId: user.staffAccessOperationId,
      })
      .from(user)
      .where(eq(user.id, row.userId))
      .for('update');
    if (owner === undefined) return 'INVALID';
    if (!rule(owner.email, owner.staffAccessOperationId)) return 'INVALID';
    if (!Buffer.from(input.identify(owner.email)).equals(row.recipientHash)) return 'INVALID';
    if (!input.compare(row)) return 'INVALID';
    await tx
      .update(challenges)
      .set({
        status: 'CONSUMED',
        codeMac: null,
        consumedAt: found.now,
        finishedAt: found.now,
        updatedAt: found.now,
      })
      .where(and(eq(challenges.id, input.challengeId), eq(challenges.status, 'ACTIVE')));
    await writePassword(tx, owner.id, input, found.now);
    // كل الجلسات القديمة بتتقفل: التعيين بيطلب من المستخدم يسجل دخول من جديد.
    await tx.delete(session).where(eq(session.userId, owner.id));
    await tx
      .delete(verification)
      .where(
        and(
          eq(verification.value, owner.id),
          like(verification.identifier, `${RESET_LINK_PREFIX}%`),
        ),
      );
    await tx.execute(sql`INSERT INTO platform_audit_log(id,actor,action,target_user_id,details)
        VALUES(${input.auditId},${owner.id},'reset.completed',${owner.id},'{}'::jsonb)`);
    return 'RESET';
  });

/** كتابة كلمة المرور على حساب الدخول المقفول، أو إنشاؤه لو مش موجود. */
async function writePassword(
  tx: Tx,
  userId: string,
  input: PasswordResetConsumption,
  now: Date,
): Promise<void> {
  const [login] = await tx
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .for('update');
  if (login === undefined) {
    await tx.insert(account).values({
      id: input.accountId,
      accountId: userId,
      providerId: 'credential',
      userId,
      password: input.passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }
  await tx
    .update(account)
    .set({ password: input.passwordHash, updatedAt: now })
    .where(eq(account.id, login.id));
}

/**
 * يبني حدود استرجاع كلمة المرور بالإيميل على واجهة الهوية المحصورة.
 *
 * @param runtime اتصال الهوية المحدود على pospay_auth
 * @param rule قاعدة الأهلية: حساب الاعتماد غير الموظف
 * @returns القراءة والتحضير والفحص والاستهلاك
 */
export function passwordResetOtpQueries(
  runtime: OtpRuntime,
  rule: CredentialAccountRule,
): PasswordResetOtpQueries {
  return {
    lookupCredentialUserByEmail: (email, deadline) =>
      lookupCredentialUser(runtime, email, deadline),
    prepareEmailResetChallenge: (input) => prepareEmailReset(runtime, input),
    verifyPasswordResetOtp: (challengeId, compare, auditId, deadline) =>
      verifyOtpChallenge(runtime, passwordResetScope, challengeId, compare, auditId, deadline),
    consumePasswordResetOtp: (input) => consumePasswordReset(runtime, rule, input),
  };
}
