import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';

// كل مسارات شجرة staff-access مقفولة معاً: أي مسار جديد تحت الشجرة يورث البوابة من غير تعديل.
// الشرط «/» بعد staff-access بيخلي المسارات الشقيقة (staff-access-something) بره النطاق.
const STAFF_ACCESS_ROUTE = /^\/v1\/businesses\/:businessId\/employees\/:employeeId\/staff-access(?:\/.*)?$/;

/**
 * بوابة القدرة كـ onRequest على كل مسارات شجرة دخول الموظفات: تعمل بعد خطّاف CORS على مستوى
 * التطبيق (الذي يجيب الـ preflight ويضيف ترويسات الأصل) وقبل المصادقة والحراس وتحليل الجسم، فيصل
 * NOT_READY للمتصفح مقروءاً ثابتاً لكل طالب قبل التفعيل.
 */
export function mountStaffAccessGate(server: FastifyInstance, enabled: boolean): void {
  if (enabled) return;
  const refuse = async (_request: FastifyRequest, reply: FastifyReply) => {
    const error = new ApiError('NOT_READY');
    return reply.code(error.status).send(error.toEnvelope());
  };
  server.addHook('onRoute', (route) => {
    if (!STAFF_ACCESS_ROUTE.test(route.url)) return;
    const existing = route.onRequest;
    route.onRequest =
      existing === undefined ? [refuse] : [...(Array.isArray(existing) ? existing : [existing]), refuse];
  });
}
