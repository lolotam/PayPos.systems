import { withRequestContext, type RequestContext } from '@pospay/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';

// Each request's own log context, looked up by the request so a callback running elsewhere can restore it.
export const contexts = new WeakMap<FastifyRequest, RequestContext>();

// One line per request with safe, structural fields only: the route PATTERN, never the raw URL, whose path segments
// and query string can carry tokens or phone numbers.
export function logCompleted(request: FastifyRequest, reply: FastifyReply): void {
  const write = () =>
    request.log.info(
      {
        http: {
          method: request.method,
          route: request.routeOptions.url ?? '[unmatched]',
          status: reply.statusCode,
          ms: Math.round(reply.elapsedTime),
        },
      },
      'request completed',
    );
  const context = contexts.get(request);
  if (context === undefined) write();
  else withRequestContext(context, write);
}
