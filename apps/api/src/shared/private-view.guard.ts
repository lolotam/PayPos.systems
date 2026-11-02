import { SetMetadata } from '@nestjs/common';
import type { AuthService, PrivateViewScope, StaffSession } from '@pospay/auth';
import {
  PRIVATE_VIEW_CAP_REMAINING_HEADER,
  PRIVATE_VIEW_IDLE_REMAINING_HEADER,
  PRIVATE_VIEW_WINDOW_HEADER,
} from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from './errors.ts';
import { isStaffOrigin, type StaffOrigins } from './staff-origin.token.ts';

/**
 * علامة المسار اللي بيتحقق من نافذة العرض الخاص بعد جلسة الموظف.
 * العلامة على الـ handler وحده: المسار العام ما بيعرفش، والعلامة ما بتنفّذش في المسار الشخصي.
 */
export const PRIVATE_VIEW_ROUTE = Symbol('PRIVATE_VIEW_ROUTE');

/** يعلّم المسار إنه محتاج نافذة عرض خاصة سارية. */
export const PrivateViewRoute = (): MethodDecorator => SetMetadata(PRIVATE_VIEW_ROUTE, true);

declare module 'fastify' {
  interface FastifyRequest {
    /** النافذة السارية للطلب؛ بتتحط بس بعد ما الفحص ينجح. */
    privateView?: {
      windowId: string;
      idleRemainingMs: number;
      capRemainingMs: number;
    };
  }
}

// معرّف النافذة نص base64url؛ أي شكل تاني بيت رفض بنفس خطأ الانتهاء، مش 400.
const WINDOW_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * يقرأ معرّف النافذة من الترويسة؛ المعرّف الناقص أو مش base64url بيرجع null.
 *
 * @param header قيمة الترويسة كما وصلتها
 * @returns المعرّف لو شكله صح، وnull غير كده
 */
export function privateViewWindowId(header: string | string[] | undefined): string | null {
  const value = typeof header === 'string' ? header : '';
  return WINDOW_ID.test(value) ? value : null;
}

/**
 * نطاق النافذة مثبت من جلسة الموظف وجهازها، مش من جسم الطلب.
 *
 * @param session جلسة الموظف المثبتة
 * @returns نطاق النافذة
 */
export function privateViewScope(session: StaffSession): PrivateViewScope {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    deviceId: session.context.deviceId,
  };
}

/**
 * يفحص نافذة العرض الخاص بعد ما جلسة الموظف ثبتت، ويمسّ النافذة لو سارية.
 * الفحص بيقرأ معرّف النافذة من الترويسة وبيقارنه بالجلسة؛ المعرّف نفسه ما بينكتبش في خطأ ولا في لوج.
 *
 * @param request الطلب جوه جلسة الموظف المثبتة
 * @param reply الرد عشان ترويسات الوقت المتبقي
 * @param auth خدمة الاعتماد اللي فيها نافذة العرض الخاص
 * @param origins مصادر الـ POS المسموحة؛ مصدر غريب يترفض قبل ما النافذة تتلمس
 */
export async function privateViewRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthService | null,
  origins: StaffOrigins | null,
): Promise<void> {
  // الفحص بيمدّ خمول النافذة، فطلب من مصدر مرفوض لازم يقف قبله، مش في الـ controller بعده.
  if (!isStaffOrigin(origins, request.headers.origin)) throw new ApiError('FORBIDDEN');
  if (auth === null) throw new ApiError('NOT_READY');
  const session = request.staffSession;
  if (session === undefined) throw new ApiError('UNAUTHENTICATED');
  const windowId = privateViewWindowId(request.headers[PRIVATE_VIEW_WINDOW_HEADER]);
  if (windowId === null) throw new ApiError('PRIVATE_VIEW_EXPIRED');
  const scope = privateViewScope(session);
  const result = await auth.privateView.check(scope, windowId);
  if (result.kind !== 'passed') throw new ApiError('PRIVATE_VIEW_EXPIRED');
  request.privateView = {
    windowId,
    idleRemainingMs: result.idleRemainingMs,
    capRemainingMs: result.capRemainingMs,
  };
  void reply.header(PRIVATE_VIEW_IDLE_REMAINING_HEADER, String(result.idleRemainingMs));
  void reply.header(PRIVATE_VIEW_CAP_REMAINING_HEADER, String(result.capRemainingMs));
}
