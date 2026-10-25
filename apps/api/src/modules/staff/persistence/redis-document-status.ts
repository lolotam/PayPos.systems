import {
  documentBytesKey,
  documentRenderErrorCode,
  documentRenderState,
  documentStatusKey,
} from '@pospay/contracts';
import type { Redis } from 'ioredis';

/**
 * قارئ حالة المستند من Redis؛ الواجهة (`DocumentStatusRead`) معرّفة بجوار الاستعلام في
 * `queries/`، و`persistence/` ما بيستوردش من `queries/` أصلاً، فالتوافق بيتأكد عند الربط.
 */
export function createDocumentStatusReader(redis: Redis) {
  return {
    read: async (companyId: string, renderId: string) => {
      const hash = await redis.hgetall(documentStatusKey(companyId, renderId));
      const state = documentRenderState.safeParse(hash['state']);
      const requestedBy = hash['requested_by'];
      // هاش بحالة مش معروفة أو من غير صاحب طلب بيتعامل كأنه مش موجود.
      if (!state.success || requestedBy === undefined) return null;
      const errorCode = documentRenderErrorCode.safeParse(hash['error_code']);
      const bytesPresent = (await redis.exists(documentBytesKey(companyId, renderId))) === 1;
      return {
        state: state.data,
        requestedBy,
        errorCode: errorCode.success ? errorCode.data : null,
        bytesPresent,
        mimeType: hash['mime_type'] ?? null,
      };
    },
  };
}
