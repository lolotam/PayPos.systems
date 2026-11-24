import { Injectable, Inject } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ApiError } from './errors.ts';

/** مسارات دعوة العضو (G1) اللي بتجيب 503 وإحنا مقفولين — قبل أي حدّ أو pipe تاني. */
const MEMBER_INVITATION_ROUTES = /^\/v1\/memberships\/invitations(?:\/[^/]+\/link)?$/;

/**
 * بوابة تفعيل مسارات شريحة 076 (plan §1.1): بتشتغل كأول APP_GUARD عشان الرد 503 NOT_READY
 * يوصل قبل حارس الجلسة وحارس الصلاحيات وpipes التحقق — الطلب غير المت authenticity أو
 * المشوه بيرد بنفس الـ 503، فمفيش حاجة من الشريحة بتتكشف أو بتتصرف وهي مقفولة.
 */
export const STAFF_ACCESS_ROUTES = Symbol('STAFF_ACCESS_ROUTES');

/**
 * بيقول إن مسارات الشريحة مفعّلة ولا لأ.
 *
 * @param env بيئة العملية
 * @returns true بس لما STAFF_ACCESS_ROUTES=on
 */
export function staffAccessRoutesEnabled(env: NodeJS.ProcessEnv): boolean {
  return env['STAFF_ACCESS_ROUTES'] === 'on';
}

/** الحارس اللي بيرد 503 على مسارات الدعوة والبوابة مقفولة. */
@Injectable()
export class StaffAccessRoutesGuard implements CanActivate {
  constructor(
    @Inject(STAFF_ACCESS_ROUTES) private readonly enabled: boolean,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.enabled) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (MEMBER_INVITATION_ROUTES.test(request.url.split('?')[0] ?? '')) {
      throw new ApiError('NOT_READY');
    }
    return true;
  }
}
