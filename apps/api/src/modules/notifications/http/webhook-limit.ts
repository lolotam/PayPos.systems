import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { ApiError } from '../../../shared/errors.ts';

/** The counter script both webhooks run in Redis: one counter per minute window. */
export const RATE_SCRIPT = `local n = redis.call('INCR',KEYS[1]); if n == 1 then redis.call('EXPIRE',KEYS[1],60) end; return n`;

/**
 * The per-IP limit shared by the provider webhooks. The counter lives in Redis, so the limit holds
 * across every replica; an unreachable Redis refuses the request instead of letting it through.
 *
 * @param redis         the shared Redis
 * @param key           the counter key, without the `rate:` prefix
 * @param limit         the requests allowed per minute
 * @param reply         the reply to answer on refusal
 * @param onUnavailable called when Redis itself fails
 * @returns whether the request may continue
 */
export async function limited(
  redis: Redis,
  key: string,
  limit: number,
  reply: FastifyReply,
  onUnavailable: () => void,
): Promise<boolean> {
  try {
    if (Number(await redis.eval(RATE_SCRIPT, 1, `rate:${key}`)) <= limit) return true;
    refuse(reply, 'TOO_MANY_REQUESTS');
  } catch {
    onUnavailable();
    refuse(reply, 'NOT_READY');
  }
  return false;
}

/**
 * Answers a webhook request with the shared error envelope.
 *
 * @param reply the reply
 * @param code  the catalogue code to answer with
 */
export function refuse(
  reply: FastifyReply,
  code: 'NOT_READY' | 'TOO_MANY_REQUESTS' | 'UNSUPPORTED_MEDIA_TYPE',
): void {
  const error = new ApiError(code);
  if (code === 'TOO_MANY_REQUESTS') void reply.header('retry-after', '60');
  void reply.code(error.status).send(error.toEnvelope());
}
