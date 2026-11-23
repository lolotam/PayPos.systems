import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyAdapter } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import {
  createResendEventDigest,
  resendSigningKey,
  verifyResendSignature,
} from '@pospay/notifications';
import type { ResendIntake } from './resend-webhook.controller.ts';
import { ApiError } from '../../../shared/errors.ts';
import { limited, refuse } from './webhook-limit.ts';

const ROUTE = '/v1/webhooks/resend';
const BODY_LIMIT = 65_536;
const RATE_LIMIT = 120;
const verified = new WeakMap<FastifyRequest, Buffer>();
const redisLogged = new WeakSet<FastifyRequest>();

/**
 * The permanent digest of the verified event, or undefined when the request was not verified.
 * The provider event id itself never leaves this map: only its digest reaches the database.
 */
export const verifiedResendDigest = (request: FastifyRequest): Buffer | undefined =>
  verified.get(request);

const redisUnavailable = (request: FastifyRequest): void => {
  if (redisLogged.has(request)) return;
  redisLogged.add(request);
  request.log.warn({ type: 'RedisError' }, 'resend redis unavailable');
};
const target = (req: FastifyRequest) => req.routeOptions.url === ROUTE;

/** The header value, but only when the header was sent exactly once. */
const singleHeader = (request: FastifyRequest, name: string): string | undefined => {
  const headers = request.raw.rawHeaders;
  let count = 0;
  let value: string | undefined;
  for (let index = 0; index < headers.length; index += 2) {
    if (headers[index]?.toLowerCase() !== name) continue;
    count++;
    value = headers[index + 1];
  }
  return count === 1 ? value : undefined;
};

/**
 * Mounts the intake guards of the Resend webhook: the per-IP limit, the media type and the raw-body
 * signature check. Nothing is stored and nothing is parsed before the signature is verified.
 */
export function mountResendSecurity(
  adapter: FastifyAdapter,
  intake: ResendIntake | undefined,
  redis: Redis | undefined,
): void {
  const app = adapter.getInstance<FastifyInstance>();
  app.addHook('onRequest', async (request, reply) => {
    if (!target(request)) return;
    if (intake === undefined || redis === undefined) return refuse(reply, 'NOT_READY');
    const ip = createHash('sha256').update(request.ip).digest('hex');
    if (
      !(await limited(redis, `resend:ip:POST:${ip}`, RATE_LIMIT, reply, () =>
        redisUnavailable(request),
      ))
    )
      return;
    if (
      request.headers['content-encoding'] !== undefined ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
    )
      return refuse(reply, 'UNSUPPORTED_MEDIA_TYPE');
  });
  app.addHook('onResponse', async (request) => {
    verified.delete(request);
  });
  app.addHook('onRoute', (route) => {
    if (route.url !== ROUTE || route.method !== 'POST') return;
    route.bodyLimit = BODY_LIMIT;
    route.preParsing = async (request, _reply, payload) => {
      if (intake === undefined || redis === undefined) throw new ApiError('NOT_READY');
      const parts: Buffer[] = [];
      let size = 0;
      for await (const chunk of payload) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > BODY_LIMIT) throw new ApiError('PAYLOAD_TOO_LARGE');
        parts.push(bytes);
      }
      const body = Buffer.concat(parts, size);
      const id = singleHeader(request, 'svix-id');
      const headers = {
        id,
        timestamp: singleHeader(request, 'svix-timestamp'),
        signature: singleHeader(request, 'svix-signature'),
      };
      if (
        !verifyResendSignature(body, headers, intake.config.webhookSecret, intake.clock.now())
      )
        throw new ApiError('UNAUTHENTICATED');
      if (id !== undefined)
        verified.set(request, createResendEventDigest(resendSigningKey(intake.config.webhookSecret))(id));
      return Readable.from([body]);
    };
  });
}
