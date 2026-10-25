import { DOCUMENT_PDF_MIME_TYPE } from '@pospay/contracts';
import {
  assertBytesWithinLimit,
  assertHtmlWithinLimit,
  DocumentRenderTimeoutError,
  DocumentRendererUnavailableError,
} from '@pospay/documents';

import { DocumentKindUnknownError } from './kind-error.ts';
import type { ProcessDocumentDeps } from './process-job.ts';
import type { HtmlDocumentSource } from './source-registry.ts';

type ProduceDocumentDeps = Pick<ProcessDocumentDeps, 'registry' | 'renderer'>;

interface ProducedDocument {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(new DocumentRenderTimeoutError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new DocumentRenderTimeoutError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function renderHtml(
  deps: ProduceDocumentDeps,
  source: HtmlDocumentSource,
  companyId: string,
  renderId: string,
  signal: AbortSignal,
): Promise<ProducedDocument> {
  if (!deps.renderer.isAvailable()) throw new DocumentRendererUnavailableError();
  if (signal.aborted) throw new DocumentRenderTimeoutError();
  const html = await untilAbort(source.load(companyId, renderId, signal), signal);
  assertHtmlWithinLimit(html);
  if (signal.aborted) throw new DocumentRenderTimeoutError();
  const pdf = await untilAbort(deps.renderer.render(html, { signal }), signal);
  return { bytes: pdf, mimeType: DOCUMENT_PDF_MIME_TYPE };
}

export async function produceDocument(
  deps: ProduceDocumentDeps,
  companyId: string,
  renderId: string,
  kind: string,
  signal: AbortSignal,
): Promise<ProducedDocument> {
  const source = deps.registry.get(kind);
  if (source === undefined) throw new DocumentKindUnknownError();
  if (source.output !== 'bytes') {
    return renderHtml(deps, source, companyId, renderId, signal);
  }
  if (signal.aborted) throw new DocumentRenderTimeoutError();
  const bytes = await untilAbort(source.load(companyId, renderId, signal), signal);
  assertBytesWithinLimit(bytes);
  if (signal.aborted) throw new DocumentRenderTimeoutError();
  return { bytes, mimeType: source.mimeType };
}
