import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';

/** بوابة القدرة تسبق تحليل الجسم والحراس حتى يكون NOT_READY ثابتاً لكل طالب قبل التفعيل. */
export function mountStaffAccessGate(server: FastifyInstance, enabled: boolean): void {
  server.addHook('onRequest', async (request, reply) => {
    if (!enabled && /^\/v1\/businesses\/[^/]+\/employees\/[^/]+\/staff-access(?:\/pending)?(?:\?|$)/.test(request.url)) {
      const error = new ApiError('NOT_READY');
      return reply.code(error.status).send(error.toEnvelope());
    }
  });
}
