import {
  DOCUMENT_BYTES_TTL_SECONDS,
  DOCUMENT_STATUS_TTL_SECONDS,
  documentBytesKey,
  documentStatusKey,
  type DocumentRenderErrorCode,
} from '@pospay/contracts';
import type { Redis } from 'ioredis';

/** HSET عشان requested_by وfilename اللي الـ API كتبهم ما يتمسحوش. */
export async function markRendering(redis: Redis, companyId: string, renderId: string): Promise<void> {
  const key = documentStatusKey(companyId, renderId);
  await redis.hset(key, 'state', 'RENDERING');
  await redis.expire(key, DOCUMENT_STATUS_TTL_SECONDS);
}

export async function markFailed(
  redis: Redis,
  companyId: string,
  renderId: string,
  code: DocumentRenderErrorCode,
): Promise<void> {
  const key = documentStatusKey(companyId, renderId);
  await redis.hset(key, 'state', 'FAILED', 'error_code', code);
  await redis.expire(key, DOCUMENT_STATUS_TTL_SECONDS);
}

/** NX: إعادة المحاولة ما تستبدلش بايتات اتكتبت قبل ما الحالة تتعلم. */
export async function storeReady(
  redis: Redis,
  companyId: string,
  renderId: string,
  pdf: Uint8Array,
): Promise<void> {
  const statusKey = documentStatusKey(companyId, renderId);
  await redis.set(
    documentBytesKey(companyId, renderId),
    Buffer.from(pdf),
    'EX',
    DOCUMENT_BYTES_TTL_SECONDS,
    'NX',
  );
  await redis.hset(statusKey, 'state', 'READY');
  await redis.hdel(statusKey, 'error_code');
  await redis.expire(statusKey, DOCUMENT_STATUS_TTL_SECONDS);
}
