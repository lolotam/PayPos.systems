import { fileStatus, fileUploadTicket } from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';
import { apiClient } from '@/shared/api/client';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const failure = (code: ErrorMessageCode) => ({ code, ...errorMessages(code) });

// الهيدرز اللي المتصفح بيحسبها أو fetch بيمنعها ما بتوصلش للتخزين؛ التوقيع المرسل لازم يفضل مظبوط (ADR-0047).
const browserManagedHeader =
  /^(accept-charset|accept-encoding|access-control-request-.+|connection|content-length|cookie|date|dnt|expect|host|keep-alive|origin|referer|set-cookie|te|trailer|transfer-encoding|upgrade|via|proxy-.+|sec-.+)$/i;

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function requestTicket(companyId: string, businessId: string, file: File) {
  const result = await apiClient().POST('/v1/businesses/{businessId}/files/uploads', {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body: {
      owner_module: 'orders',
      owner_entity_id: businessId,
      content_type: XLSX,
      size_bytes: file.size,
      required_permission: 'read:files:business',
    },
  });
  if (result.error) throw result.error;
  return fileUploadTicket.parse(result.data);
}

async function putBytes(ticket: Awaited<ReturnType<typeof requestTicket>>, file: File) {
  const signedHeaders = Object.entries(ticket.headers).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && !browserManagedHeader.test(entry[0]),
  );
  const put = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: Object.fromEntries(signedHeaders),
    body: file,
  });
  if (!put.ok) throw failure('STORAGE_UNAVAILABLE');
}

async function confirm(companyId: string, fileId: string) {
  const result = await apiClient().POST('/v1/files/{id}/confirm', {
    params: { header: { 'x-company-id': companyId }, path: { id: fileId } },
  });
  if (result.error) throw result.error;
}

async function awaitReady(
  companyId: string,
  fileId: string,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  // الفحص يتم في worker؛ ننتظر حتى دقيقة قبل أن نطلب من المدير المحاولة مرة أخرى.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await apiClient().GET('/v1/files/{id}', {
      params: { header: { 'x-company-id': companyId }, path: { id: fileId } },
    });
    if (result.error) throw result.error;
    const current = fileStatus.parse(result.data);
    if (current.status === 'READY') return;
    if (current.status === 'REJECTED')
      throw failure(current.rejection_code ?? 'FILE_CONTENT_INVALID');
    await wait(1000);
  }
  throw failure('FILE_NOT_READY');
}

/**
 * يرفع مصنف الاستيراد عبر مسار الملفات الموقّع: تذكرة، ثم بايتات، ثم تأكيد، ثم انتظار READY.
 *
 * @param companyId الشركة المستهدفة
 * @param businessId النشاط الذي يملك الملف
 * @param file      المصنف المختار
 * @param wait      الانتظار بين محاولات فحص الحالة (للاختبار)
 * @returns معرّف الملف الجاهز للمعاينة
 */
export async function uploadPackageImportFile(options: {
  companyId: string;
  businessId: string;
  file: File;
  wait?: (ms: number) => Promise<void>;
}): Promise<string> {
  const { companyId, businessId, file } = options;
  const ticket = await requestTicket(companyId, businessId, file);
  await putBytes(ticket, file);
  await confirm(companyId, ticket.id);
  await awaitReady(companyId, ticket.id, options.wait ?? pause);
  return ticket.id;
}
