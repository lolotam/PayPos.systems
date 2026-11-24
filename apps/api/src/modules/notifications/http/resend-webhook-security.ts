import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyAdapter } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import {
  RESEND_INTAKE_BUDGET_MS,
  createResendEventDigest,
  verifyResendSignature,
} from '@pospay/notifications';
import type { ResendIntake } from './resend-webhook.controller.ts';
import { ApiError } from '../../../shared/errors.ts';
import { limited, refuse } from './webhook-limit.ts';
import { readResendBody, RESEND_BODY_LIMIT } from './resend-body.ts';

const ROUTE = '/v1/webhooks/resend';
const RATE_LIMIT = 120;
const verified = new WeakMap<FastifyRequest, Buffer>();
const deadlines = new WeakMap<FastifyRequest, Date>();
const redisLogged = new WeakSet<FastifyRequest>();

/**
 * The permanent digest of the verified event, or undefined when the request was not verified.
 * The provider event id itself never leaves this map: only its digest reaches the database.
 */
export const verifiedResendDigest = (request: FastifyRequest): Buffer | undefined =>
  verified.get(request);

export const resendDeadline = (request: FastifyRequest): Date | undefined => deadlines.get(request);

export async function withinResendDeadline<T>(
  work: Promise<T>,
  remainingMs: number,
  onDeadline: () => T = () => {
    throw new ApiError('NOT_READY');
  },
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve, reject) => {
        timer = setTimeout(
          () => {
            try {
              resolve(onDeadline());
            } catch (error) {
              reject(error);
            }
          },
          Math.max(0, remainingMs),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const redisUnavailable = (request: FastifyRequest): void => {
  if (redisLogged.has(request)) return;
  redisLogged.add(request);
  request.log.warn({ type: 'RedisError' }, 'resend redis unavailable');
};
const target = (req: FastifyRequest) => req.routeOptions.url === ROUTE;

/** application/json بس، ومن غير أي ترميز محتوى (spec 075 FR-001). */
const isNotJsonOnly = (request: FastifyRequest): boolean =>
  request.headers['content-encoding'] !== undefined ||
  !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '');

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
    const deadline = new Date(intake.clock.now().getTime() + RESEND_INTAKE_BUDGET_MS);
    deadlines.set(request, deadline);
    const admissionRedis = {
      eval: (...args: Parameters<Redis['eval']>) =>
        withinResendDeadline(redis.eval(...args), RESEND_INTAKE_BUDGET_MS),
    } as Redis;
    if (
      !(await limited(
        admissionRedis,
        `resend:ip:POST:${createHash('sha256').update(request.ip).digest('hex')}`,
        RATE_LIMIT,
        {
          reply,
          onUnavailable: () => redisUnavailable(request),
          overQuota: 'RATE_LIMITED',
        },
      ))
    )
      return;
    if (isNotJsonOnly(request)) return refuse(reply, 'UNSUPPORTED_MEDIA_TYPE');
  });
  app.addHook('onResponse', async (request) => {
    verified.delete(request);
    deadlines.delete(request);
  });
  app.addHook('onRoute', (route) => {
    if (route.url !== ROUTE || route.method !== 'POST') return;
    route.bodyLimit = RESEND_BODY_LIMIT;
    route.preParsing = async (request, _reply, payload) => {
      if (intake === undefined || redis === undefined) throw new ApiError('NOT_READY');
      const deadline = deadlines.get(request);
      if (deadline === undefined || intake.clock.now().getTime() >= deadline.getTime())
        throw new ApiError('NOT_READY');
      const body = await readResendBody(payload, deadline.getTime() - intake.clock.now().getTime());
      const id = singleHeader(request, 'svix-id');
      const headers = {
        id,
        timestamp: singleHeader(request, 'svix-timestamp'),
        signature: singleHeader(request, 'svix-signature'),
      };
      if (!verifyResendSignature(body, headers, intake.config.webhookSecret, intake.clock.now()))
        throw new ApiError('UNAUTHENTICATED');
      if (id !== undefined)
        verified.set(request, createResendEventDigest(intake.config.eventDigestKey)(id));
      return Readable.from([body]);
    };
  });
}
