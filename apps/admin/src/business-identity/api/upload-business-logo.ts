import { fileStatus, fileUploadTicket, type RequestFileUpload } from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';
import { apiClient } from '@/shared/api/client';
import { withHttpStatus } from './identity-client';

export type LogoPhase = 'idle' | 'uploading' | 'verifying' | 'ready' | 'rejected';

const browserManagedHeader =
  /^(accept-charset|accept-encoding|access-control-request-.+|connection|content-length|cookie|date|dnt|expect|host|keep-alive|origin|referer|set-cookie|te|trailer|transfer-encoding|upgrade|via|proxy-.+|sec-.+)$/i;
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const failure = (code: ErrorMessageCode) => ({ code, ...errorMessages(code) });

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

export async function uploadBusinessLogo(options: {
  companyId: string;
  businessId: string;
  contentType: 'image/png' | 'image/jpeg';
  file: File;
  onPhase?: (phase: LogoPhase) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<string> {
  const { companyId, businessId, contentType, file, onPhase } = options;
  onPhase?.('uploading');
  const id = await confirmedUpload(companyId, businessId, file, contentType);
  onPhase?.('verifying');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await apiClient().GET('/v1/files/{id}', {
      params: { header: { 'x-company-id': companyId }, path: { id } },
    });
    if (status.error) throw withHttpStatus(status.error, status.response.status);
    const current = fileStatus.parse(status.data);
    if (current.status === 'READY') return id;
    if (current.status === 'REJECTED')
      throw failure(current.rejection_code ?? 'FILE_CONTENT_INVALID');
    await (options.wait ?? pause)(1000);
  }
  throw failure('FILE_NOT_READY');
}
