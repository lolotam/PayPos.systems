import { and, desc, eq, like } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { IdentitySchema } from './auth-database.ts';
import { account, user, verification } from '../schema/identity-auth.ts';

/** بادئة identifier لصف verification الخاص برابط تعيين كلمة المرور — نفس شكل Better Auth. */
export const RESET_LINK_PREFIX = 'reset-password:';

/** مدخلات استهلاك رابط تعيين كلمة المرور: القيم محسوبة قبل المعاملة، وساعة الاستهلاك بتتقري جواها. */
export interface ResetLinkConsumption {
  /** `reset-password:<token>` زي ما Better Auth بيخزنه. */
  readonly identifier: string;
  /** hash كلمة المرور محسوب بره المعاملة — الـ hash بطيء ومينفعش يتعمل تحت قفل صف. */
  readonly passwordHash: string;
  /** معرّف صف حساب الدخول لو اليوزر ملوش صف (بيتكتب بس في الحالة دي). */
  readonly accountId: string;
  /**
   * قراءة ساعة الاستهلاك — بتتنادى جوه المعاملة بعد قفل صف اليوزر بالظبط، مش قبلها: رابط بينتهي
   * وإحنا مستنيين القفل بيرفض هنا حتى لو كان شكله حي لحظة بداية الطلب.
   */
  readonly now: () => Date;
}

/** استهلاك روابط تعيين كلمة المرور — كل SQL هنا، والباقي ما بيلمسش verification ولا account. */
export interface PasswordResetQueries {
  /**
   * هل فيه رابط بالـ identifier ده لسه ما انتهاش؛ قراءة من غير قفل بس عشان نرفض توكن غلط
   * قبل ما نبذل وقت الـ hash، مش عشان نحكم بيها على الاستهلاك.
   *
   * @param identifier `reset-password:<token>`
   * @param now ساعة الطلب
   */
  linkIsLive(identifier: string, now: Date): Promise<boolean>;
  /**
   * بيستهلك الرابط ويكتب كلمة المرور ويمسح باقي روابط اليوزر في معاملة واحدة تحت قفل صف
   * اليوزر — نفس القفل اللي إصدار الرابط بيستخدمه، فاستهلاك وإصدار لنفس اليوزر مايتداخلوش.
   * أي فشل في أي خطوة بيرجّع المعاملة كلها: كلمة المرور ماتتحطش والرابط يفضل صالح للمحاولة.
   *
   * @returns `invalid-link` لما الرابط اتستهلك أو انتهى أو اليوزر اتمسح، وإلا `done`
   */
  consumeLinkAndSetPassword(input: ResetLinkConsumption): Promise<'done' | 'invalid-link'>;
}

type Database = PostgresJsDatabase<IdentitySchema>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const linkIsLive = async (db: Database, identifier: string, now: Date): Promise<boolean> => {
  const [latest] = await db
    .select({ expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .orderBy(desc(verification.createdAt))
    .limit(1);
  return latest !== undefined && latest.expiresAt.getTime() > now.getTime();
};

/** كتابة كلمة المرور على حساب الدخول المقفول، أو إنشاؤه لو مش موجود — زي ما Better Auth بيعمل. */
async function writePassword(
  tx: Transaction,
  userId: string,
  input: ResetLinkConsumption,
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

const consumeLinkAndSetPassword = async (
  db: Database,
  input: ResetLinkConsumption,
): Promise<'done' | 'invalid-link'> =>
  db.transaction(async (tx) => {
    const [link] = await tx
      .select({ userId: verification.value })
      .from(verification)
      .where(eq(verification.identifier, input.identifier))
      .limit(1);
    if (link === undefined) return 'invalid-link';
    // قفل صف اليوزر أول حاجة: إصدار الرابط بياخد نفس القفل بنفس الترتيب (يوزر ثم حساب)، فمفيش
    // طلب إصدار يقدر يدخل بين استهلاك الرابط وكتابة كلمة المرور.
    const [owner] = await tx
      .select({ id: user.id, staffOperation: user.staffAccessOperationId })
      .from(user)
      .where(eq(user.id, link.userId))
      .for('update');
    if (owner === undefined) return 'invalid-link';
    // حساب الموظفة مالوش credential أبداً (spec 076 D8): الرفض هنا تحت القفل، قبل استهلاك الرابط وقبل
    // أي كتابة، مهما كان مصدر التوكن في الطلب (جسم أو query) — الكتابة هنا SQL مباشر ما بيعدّيش على
    // حارس Better Auth adapter.
    if (owner.staffOperation !== null) return 'invalid-link';
    // ساعة الاستهلاك بتتقري بعد القفل: رابط بينتهي وإحنا مستنيين قفل اليوزر بيرفض هنا، والاستهلاك
    // بعد القفل: لو طلب تاني استهلك نفس الرابط أو إصدار جديد مسحه، الحذف هنا بيرجّع صفر.
    const now = input.now();
    const consumed = await tx
      .delete(verification)
      .where(eq(verification.identifier, input.identifier))
      .returning({ expiresAt: verification.expiresAt, userId: verification.value });
    const live = consumed.find(
      (row) => row.userId === owner.id && row.expiresAt.getTime() > now.getTime(),
    );
    if (live === undefined) return 'invalid-link';
    await writePassword(tx, owner.id, input, now);
    // كل رابط تاني لنفس اليوزر بيموت مع كلمة المرور في نفس المعاملة: لو المسح فشل، كلمة المرور
    // نفسها بتتراجع، فمفيش حالة فيها كلمة مرور متحطة ورابط حي.
    await tx
      .delete(verification)
      .where(
        and(
          eq(verification.value, owner.id),
          like(verification.identifier, `${RESET_LINK_PREFIX}%`),
        ),
      );
    return 'done';
  });

/**
 * حدود استهلاك رابط تعيين كلمة المرور على pospay_auth. بتحل محل مسار Better Auth الأصلي
 * (استهلاك، ثم hash، ثم كتابة في خطوات منفصلة من غير قفل) بمسار واحد ذري تحت قفل صف اليوزر.
 *
 * @param db اتصال الهوية على pospay_auth
 * @returns القراءة والاستهلاك
 */
export function passwordResetQueries(db: Database): PasswordResetQueries {
  return {
    linkIsLive: (identifier, now) => linkIsLive(db, identifier, now),
    consumeLinkAndSetPassword: (input) => consumeLinkAndSetPassword(db, input),
  };
}
