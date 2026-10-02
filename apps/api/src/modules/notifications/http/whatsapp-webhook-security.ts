import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyAdapter } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { verifyWhatsappSignature } from '@pospay/notifications';
import type { WhatsappIntake } from './whatsapp-webhook.controller.ts';
import { ApiError } from '../../../shared/errors.ts';

const ROUTE = '/v1/webhooks/whatsapp';
const RATE = `local n = redis.call('INCR',KEYS[1]); if n == 1 then redis.call('EXPIRE',KEYS[1],60) end; return n`;
const RESERVE = `local t = redis.call('TIME'); local now = t[1]*1000 + math.floor(t[2]/1000);
  redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now);
  if redis.call('ZCARD',KEYS[1]) >= 32 then return 0 end;
  redis.call('ZADD',KEYS[1],now+120000,ARGV[1]); redis.call('EXPIRE',KEYS[1],180); return 1`;
const verified = new WeakSet<FastifyRequest>();
const redisLogged = new WeakSet<FastifyRequest>();
export const isWhatsappVerified = (request: FastifyRequest): boolean => verified.has(request);
const redisUnavailable = (request: FastifyRequest): void => {
  if (redisLogged.has(request)) return;
  redisLogged.add(request);
  request.log.warn({ type: 'RedisError' }, 'whatsapp redis unavailable');
};
const active = new WeakMap<FastifyRequest, string>();
const target = (req: FastifyRequest) => req.routeOptions.url === ROUTE;
const signature = (req: FastifyRequest) => {
  const headers = req.raw.rawHeaders;
  const count = headers.filter(
    (_, i) => i % 2 === 0 && headers[i]?.toLowerCase() === 'x-hub-signature-256',
  ).length;
  return count === 1 ? req.headers['x-hub-signature-256'] : undefined;
};

export function mountWhatsappSecurity(
  adapter: FastifyAdapter,
  intake: WhatsappIntake | undefined,
  redis: Redis | undefined,
): void {
  const app = adapter.getInstance<FastifyInstance>();
  app.addHook('onRequest', async (request, reply) => {
    if (!target(request)) return;
    if (intake === undefined || redis === undefined) return refuse(reply, 'NOT_READY');
    const ip = createHash('sha256').update(request.ip).digest('hex');
    if (
      !(await limited(
        redis,
        `whatsapp:ip:${request.method}:${ip}`,
        request.method === 'GET' ? 10 : 120,
        reply,
        request,
      ))
    )
      return;
    if (request.method === 'POST') {
      if (
        request.headers['content-encoding'] !== undefined ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
      )
        return refuse(reply, 'UNSUPPORTED_MEDIA_TYPE');
      try {
        const reservation = randomUUID();
        if ((await redis.eval(RESERVE, 1, 'whatsapp:concurrency', reservation)) !== 1)
          return refuse(reply, 'TOO_MANY_REQUESTS');
        active.set(request, reservation);
      } catch {
        redisUnavailable(request);
        return refuse(reply, 'NOT_READY');
      }
    }
  });
  app.addHook('onResponse', async (request) => {
    const reservation = active.get(request);
    if (reservation !== undefined) {
      active.delete(request);
      try {
        await redis?.zrem('whatsapp:concurrency', reservation);
      } catch {
        redisUnavailable(request);
      }
    }
    verified.delete(request);
  });
  registerVerifiedParser(adapter, intake, redis);
}

function registerVerifiedParser(
  adapter: FastifyAdapter,
  intake: WhatsappIntake | undefined,
  redis: Redis | undefined,
): void {
  const app = adapter.getInstance<FastifyInstance>();
  // الحارس يتثبت على مسار الويبهوك وحده؛ يتحقق من البايتات قبل محلل JSON الافتراضي ولا يغيّر باقي المسارات.
  app.addHook('onRoute', (route) => {
    if (route.url !== ROUTE || route.method !== 'POST') return;
    route.bodyLimit = 1_048_576;
    route.preParsing = async (request, _reply, payload) => {
      if (intake === undefined || redis === undefined) throw new ApiError('NOT_READY');
      const parts: Buffer[] = [];
      let size = 0;
      for await (const chunk of payload) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 1_048_576) throw new ApiError('PAYLOAD_TOO_LARGE');
        parts.push(bytes);
      }
      const body = Buffer.concat(parts, size);
      if (!verifyWhatsappSignature(body, signature(request), intake.config.appSecret))
        throw new ApiError('UNAUTHENTICATED');
      await verifiedPhoneNumberBudget(redis, intake.config.phoneNumberId, request);
      verified.add(request);
      return Readable.from([body]);
    };
  });
}

async function verifiedPhoneNumberBudget(
  redis: Redis,
  id: string,
  request: FastifyRequest,
): Promise<void> {
  try {
    if (Number(await redis.eval(RATE, 1, `rate:whatsapp:phone-number:${id}`)) > 600)
      throw new ApiError('TOO_MANY_REQUESTS');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    redisUnavailable(request);
    throw new ApiError('NOT_READY');
  }
}

async function limited(
  redis: Redis,
  key: string,
  limit: number,
  reply: FastifyReply,
  request: FastifyRequest,
): Promise<boolean> {
  try {
    if (Number(await redis.eval(RATE, 1, `rate:${key}`)) <= limit) return true;
    refuse(reply, 'TOO_MANY_REQUESTS');
  } catch {
    redisUnavailable(request);
    refuse(reply, 'NOT_READY');
  }
  return false;
}

function refuse(
  reply: FastifyReply,
  code: 'NOT_READY' | 'TOO_MANY_REQUESTS' | 'UNSUPPORTED_MEDIA_TYPE',
): void {
  const error = new ApiError(code);
  if (code === 'TOO_MANY_REQUESTS') void reply.header('retry-after', '60');
  void reply.code(error.status).send(error.toEnvelope());
}
