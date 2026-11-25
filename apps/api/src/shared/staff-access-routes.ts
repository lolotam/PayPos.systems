import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from './errors.ts';

/**
 * مسارات دعوة العضو (G1) كما بتتسجل في Fastify (بادئة v1 اختيارية، ومعامل المسار بنقطتين) —
 * بوابة التفعيل بتتركب عليها قبل أي parsing للمحتوى أو حارس.
 */
export const MEMBER_INVITATION_ROUTE = /^\/(?:v1\/)?memberships\/invitations(?:\/:[^/]+\/link)?$/;

/** مسار إنهاء العضوية (G2) بنفس شكل التسجيل: بوابة التفعيل بتغطيه زي مسارات الدعوة. */
export const MEMBERSHIP_END_ROUTE = /^\/(?:v1\/)?memberships\/:[^/]+\/end$/;

/**
 * بيقول إن مسارات شريحة 076 مفعّلة ولا لأ (plan §1.1): القيمة بتتقرأ مرة واحدة عند الإقلاع.
 *
 * @param env بيئة العملية
 * @returns true بس لما STAFF_ACCESS_ROUTES=on
 */
export function staffAccessRoutesEnabled(env: NodeJS.ProcessEnv): boolean {
  return env['STAFF_ACCESS_ROUTES'] === 'on';
}

/**
 * بوابة التفعيل (plan §1.1): وهي مقفولة بتركّب خطّاف onRequest على مسارات الدعوة، فبيرد
 * 503 NOT_READY قبل parsing الجسم وقبل حارس الجلسة وقبل أي pipe — الطلب غير المسجّل أو
 * المشوّه، حتى JSON باطل، بيرد نفس الرد.
 *
 * @param app     نسخة Fastify قبل تسجيل المسارات
 * @param enabled هل الشريحة مفعّلة (STAFF_ACCESS_ROUTES=on)
 */
export function mountMemberInvitationGate(app: FastifyInstance, enabled: boolean): void {
  if (enabled) return;
  const gate = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const error = new ApiError('NOT_READY');
    void reply.code(error.status).send(error.toEnvelope());
  };
  app.addHook('onRoute', (route) => {
    if (!MEMBER_INVITATION_ROUTE.test(route.url) && !MEMBERSHIP_END_ROUTE.test(route.url)) return;
    if (route.onRequest === undefined) route.onRequest = gate;
    else if (typeof route.onRequest === 'function') route.onRequest = [route.onRequest, gate];
    else route.onRequest = [...route.onRequest, gate];
  });
}
