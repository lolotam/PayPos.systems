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
 * بيعمل يوزر من ناحية السيرفر (التسجيل مقفول، ADR-0003 §6) ويسجّل ده في platform_audit_log، ويطلّع رابط يستخدمه
 * اليوزر مرة واحدة يحط بيه الباسورد. الباسورد المبدئي عشوائي ومحدش بيشوفه، فمفيش سر بيتبعت غير الرابط.
 *
 * @param auth  الـ AuthService على pospay_auth
 * @param input الإيميل والاسم واسم الـ operator وصفحة الـ set-password
 * @returns الـ id بتاع اليوزر والرابط — الرابط بيتسلم للـ operator ومبيتكتبش في log
 */
export async function createPlatformUser(
  auth: AuthService,
  input: CreatePlatformUserInput,
): Promise<{ userId: string; link: string }> {
  const userId = await auth.provisionUser({
    email: input.email,
    name: input.name,
    password: randomBytes(32).toString('base64url'),
  });
  await auth.recordPlatformAction({
    actor: input.operator,
    action: 'user.created',
    targetUserId: userId,
    details: {},
  });
  return { userId, link: await auth.issuePasswordSetLink(userId, input.redirectTo) };
}
