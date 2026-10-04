import { fileStatus, fileUploadTicket } from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';
import { apiClient } from '@/shared/api/client';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const failure = (code: ErrorMessageCode) => ({ code, ...errorMessages(code) });
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** يرفع ملف الاستيراد عبر مسار files الموقّع ثم ينتظر READY قبل إرجاع معرفه. */
export async function uploadImportFile(options: {
  companyId: string;
  businessId: string;
  file: File;
  wait?: (ms: number) => Promise<void>;
}): Promise<string> {
  const { companyId, businessId, file } = options;
  const header = { 'x-company-id': companyId };
  const ticket = await apiClient().POST('/v1/businesses/{businessId}/files/uploads', {
    params: { header, path: { businessId } },
    body: {
      owner_module: 'staff',
      owner_entity_id: businessId,
      content_type: XLSX,
      size_bytes: file.size,
      // سياسة files تفرض read:files:business على مالك staff؛ الاستيراد نفسه يعيد التحقق من صاحب الملف والنشاط.
      required_permission: 'read:files:business',
    },
  });
  if (ticket.error) throw ticket.error;
  const upload = fileUploadTicket.parse(ticket.data);
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await apiClient().GET('/v1/files/{id}', {
      params: { header, path: { id: upload.id } },
    });
    if (status.error) throw status.error;
    const current = fileStatus.parse(status.data);
    if (current.status === 'READY') return upload.id;
    if (current.status === 'REJECTED')
      throw failure(current.rejection_code ?? 'FILE_CONTENT_INVALID');
    await (options.wait ?? pause)(1000);
  }
  throw failure('FILE_NOT_READY');
}
