import { documentBytesKey, documentStatusKey } from '@pospay/contracts';
import type { Redis } from 'ioredis';

import type { DocumentBytesStore } from '../ports/attendance-statement.port.ts';
import { createDocumentStatusReader } from './redis-document-status.ts';

/**
 * التسليم بيتسجل بحركة واحدة من READY بس؛ لو الحالة اتغيرت في نفس اللحظة، التسليم بيفضل زي ما هو.
 */
const MARK_CONSUMED = `
local state = redis.call('HGET', KEYS[1], 'state')
if state == 'READY' then
  redis.call('HSET', KEYS[1], 'state', 'CONSUMED')
  return 1
end
return 0
`;

export function createRedisDocumentBytesStore(redis: Redis): DocumentBytesStore {
  const reader = createDocumentStatusReader(redis);
  return {
    status: async (companyId, renderId) => {
      const facts = await reader.read(companyId, renderId);
      if (facts === null) return null;
      return {
        state: facts.state,
        requestedBy: facts.requestedBy,
        mimeType: facts.mimeType,
      };
    },
    take: async (companyId, renderId) => {
      const bytes = await redis.getdelBuffer(documentBytesKey(companyId, renderId));
      return bytes === null ? null : new Uint8Array(bytes);
    },
    markConsumed: async (companyId, renderId) => {
      await redis.eval(MARK_CONSUMED, 1, documentStatusKey(companyId, renderId));
    },
  };
}
