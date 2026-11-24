import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { IdGenerator } from '@pospay/db';
import { enterRequestContext, withRequestContext, type Logger, type RequestContext } from '@pospay/observability';
import { LogController, type FastifyReply, type FastifyRequest } from 'fastify';
import { RATING_ROUTE } from './modules/customers/index.ts';
import { ApiError, codeForStatus } from './shared/errors.ts';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
// Node's default 16 KiB covers the request line and every header together. The plan-employee cursor can
// occupy 12288 URL characters and browser cookies share that budget, so set it explicitly
// (SA decision recorded as 21:24); past the limit Fastify answers a raw 431 before Nest runs.
export const API_MAX_HEADER_BYTES = 32_768;

// Each request's own log context, looked up by the request so a callback running elsewhere can restore it.
const contexts = new WeakMap<FastifyRequest, RequestContext>();

// One line per request with safe, structural fields only: the route PATTERN, never the raw URL, whose path segments
// and query string can carry tokens or phone numbers.
function logCompleted(request: FastifyRequest, reply: FastifyReply): void {
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

// Fastify with the shared sanitising logger, request ids, and the envelope for errors Fastify raises itself.
export function buildAdapter(
  logger: Logger,
  ids: IdGenerator,
  trustedProxy: readonly string[],
): FastifyAdapter {
  return new FastifyAdapter({
    http: { maxHeaderSize: API_MAX_HEADER_BYTES },
    loggerInstance: logger,
    // A caller's X-Request-Id is kept when it is a plain token (so a trace spans the admin app and the API);
    // anything else — too long, or with characters that could forge a log line — is replaced with a UUID v7.
    genReqId: (request: {
      headers: Record<string, string | string[] | undefined>;
      url?: string | undefined;
    }) => {
      const path = (request.url ?? '').split('?')[0] ?? '';
      // The rating routes carry a credential in a header. A client that sends it as the request id must not
      // see it echoed back in the response header or in the log lines, so those routes always get a fresh id.
      if (RATING_ROUTE.test(path)) return ids.newId();
      // Provider request headers can carry phone-bearing message ids too; generate our own diagnostic id.
      try {
        const decodedPath = decodeURIComponent(path);
        if (RATING_ROUTE.test(decodedPath)) return ids.newId();
        if (/^\/v1\/(webhooks\/|devices\/me\/staff-|staff\/)/.test(decodedPath)) return ids.newId();
      } catch {
        return ids.newId();
      }
      const given = request.headers['x-request-id'];
      return typeof given === 'string' && REQUEST_ID.test(given) ? given : ids.newId();
    },
    bodyLimit: 1_048_576,
    requestTimeout: 30_000,
    trustProxy: [...trustedProxy],
    // Fastify's own request log serialises the raw URL; we log one safe line per request instead (below).
    // Its per-request error lines go too — the envelope filter logs unhandled errors through the sanitiser.
    logController: new LogController({ disableRequestLogging: true }),
    // A malformed URL (e.g. `/%ZZ`) is rejected by Fastify's router before Nest runs; answer with the
    // envelope instead of Fastify's default body, which echoes the malformed input.
    frameworkErrors: (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      const status = (error as { statusCode?: unknown }).statusCode;
      // A catalogued Fastify status keeps its code (413, 414, 415…); another 4xx is BAD_REQUEST; a
      // server-side failure stays a 500. A missing status (a malformed URL) is a bad request.
      const apiError = new ApiError(
        typeof status === 'number' ? codeForStatus(status) : 'BAD_REQUEST',
      );
      // The router rejected this request before any hook ran: give it its id and its log lines here.
      contexts.set(request, enterRequestContext(request.id));
      void reply.header('x-request-id', request.id);
      // المسارات العامة للتقييم بترد من غير hook، فالترويسات بتتحط هنا كمان عشان كل رد يطلع منها.
      void reply.header('cache-control', 'no-store');
      void reply.header('referrer-policy', 'no-referrer');
      // Fastify's own error logging is off, so a framework-side failure is logged here (type/code only).
      if (apiError.code === 'INTERNAL_ERROR') request.log.error({ err: error }, 'unhandled error');
      void reply.code(apiError.status).send(apiError.toEnvelope());
      logCompleted(request, reply);
    },
  });
}

export function mountRequestLogging(adapter: FastifyAdapter): void {
  // Every log line of the request carries its id; the guards add the verified user and company (T11). The context
  // is kept on the request: with HTTP pipelining, Node flushes a finished response from ANOTHER request's
  // completion, so onResponse must log inside this request's own context, never whatever is current.
  adapter.getInstance().addHook('onRequest', async (request, reply) => {
    contexts.set(request, enterRequestContext(request.id));
    void reply.header('x-request-id', request.id);
  });
  adapter.getInstance().addHook('onResponse', async (request, reply) => {
    logCompleted(request, reply);
  });
}
