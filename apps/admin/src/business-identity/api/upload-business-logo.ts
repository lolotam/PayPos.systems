import { fileStatus, fileUploadTicket, type RequestFileUpload } from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';
import { apiClient } from '@/shared/api/client';
import { withHttpStatus } from './identity-client';

export type LogoPhase = 'idle' | 'uploading' | 'verifying' | 'ready' | 'rejected';

const browserManagedHeader =
  /^(accept-charset|accept-encoding|access-control-request-.+|connection|content-length|cookie|date|dnt|expect|host|keep-alive|origin|referer|set-cookie|te|trailer|transfer-encoding|upgrade|via|proxy-.+|sec-.+)$/i;
const ATTEMPTS = 60;
const failure = (code: ErrorMessageCode) => ({ code, ...errorMessages(code) });

export function cancelledLogoUpload(): Error {
  const error = new Error('logo upload cancelled');
  error.name = 'AbortError';
  return error;
}

export function isCancelledUpload(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelledLogoUpload();
}

function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(cancelledLogoUpload());
    };
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

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledLogoUpload());
    };
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      reject(cancelledLogoUpload());
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function confirmedUpload(
  companyId: string,
  businessId: string,
  file: File,
  contentType: RequestFileUpload['content_type'],
) {
  const header = { 'x-company-id': companyId };
  const ticket = await apiClient().POST('/v1/businesses/{businessId}/files/uploads', {
    params: { header, path: { businessId } },
    body: {
      owner_module: 'settings',
      owner_entity_id: businessId,
      content_type: contentType,
      size_bytes: file.size,
      required_permission: 'read:settings:business',
    },
  });
  if (ticket.error) throw withHttpStatus(ticket.error, ticket.response.status);
  const upload = fileUploadTicket.parse(ticket.data);
  // كل هيدر موقّع لازم يوصل للتخزين (ADR-0047)؛ بنستبعد بس الهيدرز اللي المتصفح بيحسبها أو ممنوعة في fetch.
  const signedHeaders = Object.entries(upload.headers).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && !browserManagedHeader.test(entry[0]),
  );
  const put = await fetch(upload.upload_url, {
    method: 'PUT',
    headers: Object.fromEntries(signedHeaders),
    body: file,
  });
  if (!put.ok) throw failure('STORAGE_UNAVAILABLE');
  const confirmed = await apiClient().POST('/v1/files/{id}/confirm', {
    params: { header, path: { id: upload.id } },
  });
  if (confirmed.error) throw withHttpStatus(confirmed.error, confirmed.response.status);
  return upload.id;
}

async function readLogoStatus(companyId: string, id: string) {
  const status = await apiClient().GET('/v1/files/{id}', {
    params: { header: { 'x-company-id': companyId }, path: { id } },
  });
  if (status.error) throw withHttpStatus(status.error, status.response.status);
  return fileStatus.parse(status.data);
}

async function pollReady(
  companyId: string,
  id: string,
  signal: AbortSignal | undefined,
  wait: (ms: number) => Promise<void>,
) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    const current = await raceAbort(readLogoStatus(companyId, id), signal);
    throwIfAborted(signal);
    if (current.status === 'READY') return id;
    if (current.status === 'REJECTED') {
      throw failure(current.rejection_code ?? 'FILE_CONTENT_INVALID');
    }
    await raceAbort(wait(1000), signal);
  }
  throw failure('FILE_NOT_READY');
}

export async function uploadBusinessLogo(options: {
  companyId: string;
  businessId: string;
  contentType: 'image/png' | 'image/jpeg';
  file: File;
  onPhase?: (phase: LogoPhase) => void;
  wait?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<string> {
  const { companyId, businessId, contentType, file, onPhase, signal } = options;
  const wait = options.wait ?? ((ms: number) => pause(ms, signal));
  throwIfAborted(signal);
  onPhase?.('uploading');
  const id = await raceAbort(confirmedUpload(companyId, businessId, file, contentType), signal);
  throwIfAborted(signal);
  onPhase?.('verifying');
  return pollReady(companyId, id, signal, wait);
}
