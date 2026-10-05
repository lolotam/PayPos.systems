import { fileStatus, fileUploadTicket, type RequestFileUpload } from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';
import { apiClient } from '@/shared/api/client';

export type UploadPhase = 'idle' | 'uploading' | 'verifying' | 'recording';

const failure = (code: ErrorMessageCode) => ({ code, ...errorMessages(code) });
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function confirmedUpload(
  companyId: string,
  businessId: string,
  ownerEntityId: string,
  file: File,
  contentType: RequestFileUpload['content_type'],
) {
  const header = { 'x-company-id': companyId };
  const ticket = await apiClient().POST('/v1/businesses/{businessId}/files/uploads', {
    params: { header, path: { businessId } },
    body: {
      owner_module: 'staff',
      owner_entity_id: ownerEntityId,
      content_type: contentType,
      size_bytes: file.size,
      required_permission: 'read:files:business',
    },
  });
  if (ticket.error) throw ticket.error;
  const upload = fileUploadTicket.parse(ticket.data);
  // المتصفح يحسب content-length بنفسه؛ نرسل نوع المحتوى الموقّع فقط.
  const put = await fetch(upload.upload_url, {
    method: 'PUT',
    headers: { 'content-type': upload.headers['content-type'] },
    body: file,
  });
  if (!put.ok) throw failure('STORAGE_UNAVAILABLE');
  const confirmed = await apiClient().POST('/v1/files/{id}/confirm', {
    params: { header, path: { id: upload.id } },
  });
  if (confirmed.error) throw confirmed.error;
  return upload.id;
}

export async function uploadStaffFile(options: {
  companyId: string;
  businessId: string;
  ownerEntityId: string;
  contentType: RequestFileUpload['content_type'];
  file: File;
  onPhase?: (phase: UploadPhase) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<string> {
  const { companyId, businessId, ownerEntityId, contentType, file, onPhase } = options;
  onPhase?.('uploading');
  const id = await confirmedUpload(companyId, businessId, ownerEntityId, file, contentType);
  onPhase?.('verifying');
  // الفحص يتم في worker؛ ننتظر حتى دقيقة قبل أن نطلب من المدير المحاولة مرة أخرى.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await apiClient().GET('/v1/files/{id}', {
      params: { header: { 'x-company-id': companyId }, path: { id } },
    });
    if (status.error) throw status.error;
    const current = fileStatus.parse(status.data);
    if (current.status === 'READY') return id;
    if (current.status === 'REJECTED')
      throw failure(current.rejection_code ?? 'FILE_CONTENT_INVALID');
    await (options.wait ?? pause)(1000);
  }
  throw failure('FILE_NOT_READY');
}
