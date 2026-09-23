import { AUTH_BASE_PATH, type AuthService } from '@pospay/auth';
import type { ErrorEnvelope } from '@pospay/contracts';
import type { Logger } from '@pospay/observability';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ApiError, codeForStatus } from './errors.ts';
import { toWebHeaders } from './web-headers.ts';

// Better Auth answers with a Web Response; its status, headers and every Set-Cookie go back unchanged.
// A failure (4xx/5xx) leaves as the API's envelope instead of Better Auth's own body (CLAUDE.md §6).
async function send(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.status(response.status);
  response.headers.forEach((value, name) => {
    if (!DROPPED_HEADERS.has(name)) void reply.header(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) void reply.header('set-cookie', cookies);
  if (response.status >= 400) {
    // The envelope is JSON of its own, whatever Better Auth said its body was.
    void reply.removeHeader('content-type');
    return reply.send(await toEnvelope(response));
  }
  const body = response.body === null ? null : Buffer.from(await response.arrayBuffer());
  return reply.send(body);
}

// Set-Cookie is copied as a list below; Fastify recomputes the length.
const DROPPED_HEADERS = new Set(['set-cookie', 'content-length']);
// Better Auth's error codes are fixed upper-case names (INVALID_EMAIL_OR_PASSWORD); nothing else is echoed.
const AUTH_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

async function toEnvelope(response: Response): Promise<ErrorEnvelope> {
  const code = response.status === 401 ? 'AUTHENTICATION_FAILED' : codeForStatus(response.status);
  let authCode: unknown;
  try {
    authCode = ((await response.json()) as { code?: unknown } | null)?.code;
  } catch {
    authCode = undefined;
  }
  const known = typeof authCode === 'string' && AUTH_CODE.test(authCode);
  return new ApiError(code, known ? { auth_code: authCode } : undefined).toEnvelope();
}

/**
 * Mounts Better Auth at /v1/auth/* beside Nest (sign-in, sign-out, TOTP…). These routes carry their own
 * credentials, so the session guard does not apply to them (ADR-0003 §6). A refusal (wrong password,
 * closed sign-up) and a failure inside Better Auth both leave as the error envelope, never as its message.
 *
 * @param fastify the Fastify instance under Nest
 * @param auth    the auth service
 * @param options the public base URL requests are resolved against, and the logger
 * @param options.baseURL the API's public URL (BETTER_AUTH_URL)
 * @param options.logger  the shared sanitising logger
 */
export function mountAuthRoutes(
  fastify: FastifyInstance,
  auth: AuthService,
  options: { baseURL: string; logger: Logger },
): void {
  fastify.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body =
          request.method === 'GET' || request.body === undefined
            ? undefined
            : typeof request.body === 'string'
              ? request.body
              : JSON.stringify(request.body);
        const webRequest = new Request(new URL(request.url, options.baseURL), {
          method: request.method,
          headers: toWebHeaders(request),
          ...(body === undefined ? {} : { body }),
        });
        return await send(reply, await auth.handler(webRequest));
      } catch (error) {
        options.logger.error({ err: error }, 'unhandled error');
        const failure = new ApiError('INTERNAL_ERROR');
        return reply.status(failure.status).send(failure.toEnvelope());
      }
    },
  });
}
