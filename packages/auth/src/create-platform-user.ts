import { randomBytes } from 'node:crypto';

import type { AuthService } from './config.ts';

/**
 * ما يحتاجه السكريبت عشان يعمل يوزر.
 */
export interface CreatePlatformUserInput {
  readonly email: string;
  readonly name: string;
  /** اسم الـ operator اللي شغّل السكريبت — بيتسجل في platform_audit_log. */
  readonly operator: string;
  /** صفحة الـ admin اللي اليوزر بيحط فيها الباسورد (لازم تبقى في الـ trusted origins). */
  readonly redirectTo: string;
}

/**
 * مدخل غلط من الـ operator — رسالته بتتعرض له كما هي، لأنها من كلامه هو ومفيهاش بيانات من الداتابيز.
 */
export class OperatorInputError extends Error {
  override readonly name = 'OperatorInputError';
}

const within = (value: string, max: number): boolean =>
  value.trim().length >= 1 && value.length <= max;

function validate(input: CreatePlatformUserInput): void {
  if (!within(input.operator, 255)) {
    throw new OperatorInputError('--operator must be 1–255 characters');
  }
  if (!within(input.name, 255)) throw new OperatorInputError('--name must be 1–255 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 320) {
    throw new OperatorInputError('--email is not an email address');
  }
  if (!URL.canParse(input.redirectTo)) throw new OperatorInputError('--redirect-to is not a URL');
}

/**
 * بيعمل يوزر من ناحية السيرفر (التسجيل مقفول، ADR-0003 §6) ويسجّل ده في platform_audit_log، ويطلّع رابط يستخدمه
 * اليوزر مرة واحدة يحط بيه الباسورد. الباسورد المبدئي عشوائي ومحدش بيشوفه. المدخلات بتتفحص قبل أي كتابة، ولو
 * الرابط أو السجل فشل اليوزر اللي لسه متعمل بيتمسح — مفيش يوزر من غير سجل.
 *
 * @param auth  الـ AuthService على pospay_auth
 * @param input الإيميل والاسم واسم الـ operator وصفحة الـ set-password
 * @returns الـ id بتاع اليوزر والرابط — الرابط بيتسلم للـ operator ومبيتكتبش في log
 */
export async function createPlatformUser(
  auth: AuthService,
  input: CreatePlatformUserInput,
): Promise<{ userId: string; link: string }> {
  validate(input);
  const userId = await auth.provisionUser({
    email: input.email,
    name: input.name,
    password: randomBytes(32).toString('base64url'),
  });
  try {
    const link = await auth.issuePasswordSetLink(userId, input.redirectTo);
    await auth.recordPlatformAction({
      actor: input.operator,
      action: 'user.created',
      targetUserId: userId,
      details: {},
    });
    return { userId, link };
  } catch (error) {
    await auth.discardUser(userId);
    throw error;
  }
}
