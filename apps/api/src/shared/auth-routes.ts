import { AUTH_BASE_PATH, type AuthService } from '@pospay/auth';
import type { Logger } from '@pospay/observability';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from './errors.ts';
import { toWebHeaders } from './web-headers.ts';

// Better Auth answers with a Web Response; its status, headers and every Set-Cookie go back unchanged.
async function send(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.status(response.status);
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') void reply.header(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) void reply.header('set-cookie', cookies);
  const body = response.body === null ? null : Buffer.from(await response.arrayBuffer());
  return reply.send(body);
}

/**
 * Mounts Better Auth at /v1/auth/* beside Nest (sign-in, sign-out, TOTP…). These routes carry their own
 * credentials, so the session guard does not apply to them (ADR-0003 §6). A failure inside Better Auth
 * leaves as the error envelope, never as its message.
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
