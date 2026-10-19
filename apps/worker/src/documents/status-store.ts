import {
  DOCUMENT_BYTES_TTL_SECONDS,
  DOCUMENT_STATUS_TTL_SECONDS,
  documentBytesKey,
  documentStatusKey,
  type DocumentRenderErrorCode,
} from '@pospay/contracts';
import type { Redis } from 'ioredis';

/**
 * أمر واحد. بين SET البايتات وHSET الحالة كان فيه شباك: المستخدم يعمل GETDEL
 * وإعادة المحاولة تنشر PDF تاني.
 */
const MARK_RENDERING = `
local state = redis.call('HGET', KEYS[1], 'state')
if state == 'QUEUED' or state == 'RENDERING' then
  redis.call('HSET', KEYS[1], 'state', 'RENDERING')
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  return 1
end
return 0
`;

const STORE_READY = `
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'RENDERING' then
  return 0
end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2], 'NX')
redis.call('HSET', KEYS[1], 'state', 'READY')
redis.call('HDEL', KEYS[1], 'error_code')
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

const MARK_FAILED = `
local state = redis.call('HGET', KEYS[1], 'state')
if state == 'QUEUED' or state == 'RENDERING' then
  redis.call('HSET', KEYS[1], 'state', 'FAILED', 'error_code', ARGV[1])
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

function moved(result: unknown): boolean {
  return Number(result) === 1;
}

/** QUEUED أو RENDERING بس. أي حالة تانية (أو مفتاح ناقص) بترجع false من غير كتابة. */
export async function markRendering(redis: Redis, companyId: string, renderId: string): Promise<boolean> {
  const key = documentStatusKey(companyId, renderId);
  return moved(await redis.eval(MARK_RENDERING, 1, key, String(DOCUMENT_STATUS_TTL_SECONDS)));
}

/** QUEUED أو RENDERING بس، عشان فشل متأخر ما يمسحش READY بعد التحميل. */
export async function markFailed(
  redis: Redis,
  companyId: string,
  renderId: string,
  code: DocumentRenderErrorCode,
): Promise<boolean> {
  const key = documentStatusKey(companyId, renderId);
  return moved(
    await redis.eval(MARK_FAILED, 1, key, code, String(DOCUMENT_STATUS_TTL_SECONDS)),
  );
}

/** من RENDERING بس: البايتات والحالة والانتهاء في سكربت واحد. غير كده ما يكتبش. */
export async function storeReady(
  redis: Redis,
  companyId: string,
  renderId: string,
  pdf: Uint8Array,
): Promise<boolean> {
  const statusKey = documentStatusKey(companyId, renderId);
  return moved(
    await redis.eval(
      STORE_READY,
      2,
      statusKey,
      documentBytesKey(companyId, renderId),
      Buffer.from(pdf),
      String(DOCUMENT_BYTES_TTL_SECONDS),
      String(DOCUMENT_STATUS_TTL_SECONDS),
    ),
  );
}
