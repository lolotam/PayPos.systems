import type { DocumentRenderState } from '@pospay/contracts';

import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';
import type {
  StatementExportDocumentStore,
  StatementExportJob,
  StatementExportTransport,
} from '../ports/statement-export.port.ts';

/** مستند في الذاكرة: حالته وصاحب الطلب ونوعه وبايتاته لو لسه موجودة. */
interface MemoryDocument {
  state: DocumentRenderState;
  requestedBy: string;
  mimeType: string | null;
  bytes: Uint8Array | null;
}

/** ما بيتحكم فيه كل اختبار: فشل الطابور، نبض الرندرر، وقرار حد الطلبات. */
export interface MemoryState {
  queueFails: boolean;
  rendererAlive: boolean;
  limitHits: number;
  limitAllows: boolean;
}

type Documents = Map<string, MemoryDocument>;
const keyOf = (companyId: string, renderId: string) => `${companyId}:${renderId}`;

function memoryTransport(
  documents: Documents,
  queued: StatementExportJob[],
  state: MemoryState,
): StatementExportTransport {
  return {
    rendererAlive: async () => state.rendererAlive,
    queue: async (job) => {
      if (state.queueFails) throw new Error('queue unavailable');
      queued.push(job);
      documents.set(keyOf(job.companyId, job.renderId), {
        state: 'QUEUED',
        requestedBy: job.requestedBy,
        mimeType: null,
        bytes: null,
      });
    },
    markFailed: async () => true,
  };
}

function memoryStore(documents: Documents): StatementExportDocumentStore {
  return {
    status: async (companyId, renderId) => {
      const found = documents.get(keyOf(companyId, renderId));
      return found === undefined
        ? null
        : { state: found.state, requestedBy: found.requestedBy, mimeType: found.mimeType };
    },
    take: async (companyId, renderId) => {
      const found = documents.get(keyOf(companyId, renderId));
      const bytes = found?.bytes ?? null;
      if (found !== undefined) found.bytes = null;
      return bytes;
    },
    markConsumed: async (companyId, renderId) => {
      const found = documents.get(keyOf(companyId, renderId));
      if (found?.state === 'READY') found.state = 'CONSUMED';
    },
  };
}

function memoryRateLimiter(state: MemoryState): RateLimiter {
  return {
    hit: async () => {
      state.limitHits += 1;
      return state.limitAllows;
    },
    remember: async () => undefined,
    remembered: async () => false,
    count: async () => state.limitHits,
    remaining: async () => 0,
  };
}

/**
 * نقل ومخزن مستندات وحد طلبات في الذاكرة بنفس عقود الـ ports، عشان تدفق الطلب والتحميل يتجرب على Postgres حقيقي
 * من غير Redis. مش بديل عن اختبار HTTP على Redis في CI، بس بيغطي كل قاعدة نطاق وتحميل.
 */
export function memoryDocuments() {
  const documents: Documents = new Map();
  const queued: StatementExportJob[] = [];
  const state: MemoryState = {
    queueFails: false,
    rendererAlive: false,
    limitHits: 0,
    limitAllows: true,
  };
  return {
    state,
    queued,
    transport: memoryTransport(documents, queued, state),
    store: memoryStore(documents),
    rateLimiter: memoryRateLimiter(state),
    /** يعمل زي العامل: يجهّز الملف ويخلي الحالة READY بالبايتات. */
    ready: (companyId: string, renderId: string) => {
      const found = documents.get(keyOf(companyId, renderId));
      if (found === undefined) throw new Error('the document was never queued');
      found.state = 'READY';
      found.mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      found.bytes = new Uint8Array([1, 2, 3]);
    },
    bytesPresent: (companyId: string, renderId: string) =>
      documents.get(keyOf(companyId, renderId))?.bytes != null,
  };
}
