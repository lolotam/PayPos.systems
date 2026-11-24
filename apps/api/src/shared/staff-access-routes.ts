import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from './errors.ts';

/**
 * مسارات دعوة العضو (G1) كما بتتسجل في Fastify (بادئة v1 اختيارية، ومعامل المسار بنقطتين) —
 * بوابة التفعيل بتتركب عليها قبل أي parsing للمحتوى أو حارس.
 */
export const MEMBER_INVITATION_ROUTE = /^\/(?:v1\/)?memberships\/invitations(?:\/:[^/]+\/link)?$/;

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
 * خطّاف onRequest على مسارات الشريحة وهي مقفولة: بيرد 503 NOT_READY قبل parsing الجسم وقبل
 * حارس الجلسة وقبل أي pipe، فالطلب غير المسجّل أو المشوّه — حتى JSON باطل — بيرد نفس الرد.
 *
 * @returns خطّاف Fastify بيرد 503 دايماً
 */
export function staffAccessGateHook(): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (_request, reply) => {
    const error = new ApiError('NOT_READY');
    void reply.code(error.status).send(error.toEnvelope());
  };
}
