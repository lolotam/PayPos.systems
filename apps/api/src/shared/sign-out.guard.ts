import { SetMetadata } from '@nestjs/common';
import type { SignOutOutcome, StaffSessions } from '@pospay/auth';
import type { SignOutResult } from '@pospay/contracts';
import { updateRequestContext } from '@pospay/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from './errors.ts';
import type { PersonalAuthentication } from './personal-authentication.ts';
import type { RateLimiter } from './ports/rate-limiter.port.ts';
import { isStaffOrigin, type StaffOrigins } from './staff-origin.token.ts';

/** العلامة اللي بتقول لمسار الخروج الصريح أي نوع جلسة بينهيه. */
export const SIGN_OUT_ROUTE = Symbol('SIGN_OUT_ROUTE');

/**
 * يعلن مسار خروج صريح: المسار يقرأ cookie المسار بس وبيقفل نفسه من غير principal.
 *
 * @param kind نوع الجلسة اللي المسار بينهيها
 * @returns مزخرف الـ metadata
 */
export const SignOutRoute = (kind: 'staff' | 'personal'): MethodDecorator =>
  SetMetadata(SIGN_OUT_ROUTE, kind);

// D-5: 30 طلب في الدقيقة لكل IP لكل مسار — الحد أعلى من مسارات الأجهزة لأن تليفونات
// الصالون بتشارك IP عام واحد وكل الموظفين بيخرجوا في نفس الساعة.
const SIGN_OUT_LIMIT = 30;
const SIGN_OUT_WINDOW_SECONDS = 60;

/**
 * الحاجات اللي سياسة الخروج محتاجاها: جلسات الموظف ومصدره، والجلسة الشخصية ومصدرها، والـ limiter.
 */
export interface SignOutWiring {
  readonly staffSessions: StaffSessions | null;
  readonly staffOrigin: StaffOrigins | null;
  readonly personal: PersonalAuthentication | null;
  readonly limiter: RateLimiter | null;
}

/**
 * سياسة الخروج الصريح للمسارين (spec 067 D-1): الأول الحاجات المركّبة، بعدين مطابقة الـ Origin
 * تماماً، بعدين منع ترويسة Authorization على المسار الشخصي، بعدين حد الطلبات لكل IP.
 * بعدها ما في principal ولا قراءة جلسة ولا كود أهلية أو جهاز — السلطة في إنهاء الجلسة هي
 * cookie الموقّعة اللي الـ handler بيتحقق منها (BR-001؛ addendum ADR-0019 و ADR-0027 في 2026-10-23).
 *
 * @param request الطلب
 * @param kind نوع الجلسة
 * @param wiring الحاجات اللي سياسة الخروج محتاجاها
 * @returns true لما الطلب يعدّي السياسة
 */
export async function signOutRequest(
  request: FastifyRequest,
  kind: 'staff' | 'personal',
  wiring: SignOutWiring,
): Promise<boolean> {
  const origin = kind === 'staff' ? wiring.staffOrigin : (wiring.personal?.origin ?? null);
  const sessions = kind === 'staff' ? wiring.staffSessions : (wiring.personal?.sessions ?? null);
  if (sessions === null || origin === null || wiring.limiter === null)
    throw new ApiError('NOT_READY');
  if (
    kind === 'staff'
      ? !isStaffOrigin(wiring.staffOrigin, request.headers.origin)
      : request.headers.origin !== origin
  )
    throw new ApiError('FORBIDDEN');
  if (kind === 'personal' && request.headers.authorization !== undefined)
    throw new ApiError('FORBIDDEN');
  const limiter = wiring.limiter;
  if (
    !(await limiter.hit(`sign-out:${kind}:${request.ip}`, SIGN_OUT_LIMIT, SIGN_OUT_WINDOW_SECONDS))
  )
    throw new ApiError('TOO_MANY_REQUESTS');
  return true;
}

/**
 * يحوّل نتيجة الإنهاء لرد واحد وسطر log واحد، عشان المسارين ما يكرروش نفس الكود.
 *
 * @param request الطلب
 * @param reply رد Fastify
 * @param kind نوع الجلسة
 * @param result نتيجة الإنهاء
 * @returns جسم الرد
 */
export function signOutAnswer(
  request: FastifyRequest,
  reply: FastifyReply,
  kind: 'staff' | 'personal',
  result: SignOutOutcome,
): SignOutResult {
  if (result.cookie !== null) void reply.header('set-cookie', result.cookie);
  const status = result.ended ? 'SIGNED_OUT' : 'NO_SESSION';
  if (result.ended) updateRequestContext({ userId: result.userId });
  request.log.info({ sign_out: { route: kind, status } }, 'staff session sign-out');
  return { status };
}
