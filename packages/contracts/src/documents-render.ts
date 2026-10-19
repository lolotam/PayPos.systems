import { z } from 'zod';

/** BullMQ queue the worker consumes. Producers (27g) enqueue; this slice only names it. */
export const DOCUMENTS_RENDER_QUEUE = 'documents-render';

/** Short-lived liveness flag. Absent means the API must not enqueue a render. */
export const DOCUMENT_RENDERER_ALIVE_KEY = 'documents:renderer-alive';

/** Status hash lifetime. The API poll reads it; the bytes key expires sooner. */
export const DOCUMENT_STATUS_TTL_SECONDS = 900;

/** PDF bytes are a transport buffer, not storage. A late download finds nothing. */
export const DOCUMENT_BYTES_TTL_SECONDS = 120;

/** Refreshed about once a second while Chromium is up. A crash drops it within 3s. */
export const DOCUMENT_RENDERER_ALIVE_TTL_SECONDS = 3;

/** UTF-8 byte cap of the HTML handed to Chromium. */
export const DOCUMENT_HTML_MAX_BYTES = 4 * 1024 * 1024;

/** Byte cap of the PDF written to Redis. */
export const DOCUMENT_PDF_MAX_BYTES = 8 * 1024 * 1024;

export const documentRenderStates = [
  'QUEUED',
  'RENDERING',
  'READY',
  'FAILED',
  'EXPIRED',
  'CONSUMED',
] as const;

export const documentRenderState = z.enum(documentRenderStates);

export const documentRenderErrorCodes = [
  'DOCUMENT_KIND_UNKNOWN',
  'DOCUMENT_TOO_LARGE',
  'DOCUMENT_RENDER_TIMEOUT',
  'DOCUMENT_RENDER_FAILED',
] as const;

export const documentRenderErrorCode = z.enum(documentRenderErrorCodes);

export const documentRenderJob = z.strictObject({
  company_id: z.uuid(),
  render_id: z.uuid(),
  kind: z.string().min(1).max(64),
});

export type DocumentRenderJob = z.infer<typeof documentRenderJob>;
export type DocumentRenderState = z.infer<typeof documentRenderState>;
export type DocumentRenderErrorCode = z.infer<typeof documentRenderErrorCode>;

/** Status hash for one render. The API owns requested_by and filename; the worker adds state. */
export function documentStatusKey(companyId: string, renderId: string): string {
  return `documents:status:${companyId}:${renderId}`;
}

/** PDF buffer for one render. SET NX so a retry cannot replace bytes already stored. */
export function documentBytesKey(companyId: string, renderId: string): string {
  return `documents:bytes:${companyId}:${renderId}`;
}

/** Producer options. jobId is the render id, so a double enqueue is one job. */
export function documentRenderJobOptions(renderId: string): {
  readonly jobId: string;
  readonly attempts: 2;
  readonly removeOnComplete: true;
  readonly removeOnFail: true;
} {
  return { jobId: renderId, attempts: 2, removeOnComplete: true, removeOnFail: true };
}
