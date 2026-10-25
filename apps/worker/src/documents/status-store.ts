import {
  DOCUMENT_BYTES_TTL_SECONDS,
  DOCUMENT_PDF_MIME_TYPE,
  DOCUMENT_STATUS_TTL_SECONDS,
  documentBytesKey,
  documentStatusKey,
  type DocumentRenderErrorCode,
} from '@pospay/contracts';
import type { Redis } from 'ioredis';

/**
 * أمر واحد. بين SET البايتات وHSET الحالة كان فيه شباك: المستخدم يعمل GETDEL
 * وإعادة المحاولة تنشر بايتات المستند تاني.
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
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if nowMs >= tonumber(ARGV[4]) then
  return -1
end
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'RENDERING' then
  return 0
end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2], 'NX')
redis.call('HSET', KEYS[1], 'state', 'READY', 'mime_type', ARGV[5])
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

export type StoreReadyResult = 'stored' | 'unchanged' | 'late';

function readyResult(result: unknown): StoreReadyResult {
  const code = Number(result);
  if (code === 1) return 'stored';
  if (code < 0) return 'late';
  return 'unchanged';
}

/** QUEUED أو RENDERING بس. أي حالة تانية (أو مفتاح ناقص) بترجع false من غير كتابة. */
export async function markRendering(
  redis: Redis,
  companyId: string,
  renderId: string,
): Promise<boolean> {
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
  return moved(await redis.eval(MARK_FAILED, 1, key, code, String(DOCUMENT_STATUS_TTL_SECONDS)));
}

/** من RENDERING بس وقبل مهلة Redis. رد متأخر ما ينشرش READY، وMIME بيتسجل لتحميل البايتات بنوعها. */
export async function storeReady(
  redis: Redis,
  companyId: string,
  renderId: string,
  bytes: Uint8Array,
  deadlineAtMs: number,
  mimeType = DOCUMENT_PDF_MIME_TYPE,
): Promise<StoreReadyResult> {
  const statusKey = documentStatusKey(companyId, renderId);
  return readyResult(
    await redis.eval(
      STORE_READY,
      2,
      statusKey,
      documentBytesKey(companyId, renderId),
      Buffer.from(bytes),
      String(DOCUMENT_BYTES_TTL_SECONDS),
      String(DOCUMENT_STATUS_TTL_SECONDS),
      String(deadlineAtMs),
      mimeType,
    ),
  );
}
