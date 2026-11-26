import { fileStatus, fileUploadTicket } from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';
import { apiClient } from '@/shared/api/client';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const failure = (code: ErrorMessageCode) => ({ code, ...errorMessages(code) });

// الهيدرز اللي المتصفح بيحسبها أو fetch بيمنعها ما بتوصلش للتخزين؛ التوقيع المرسل لازم يفضل مظبوط (ADR-0047).
const browserManagedHeader =
  /^(accept-charset|accept-encoding|access-control-request-.+|connection|content-length|cookie|date|dnt|expect|host|keep-alive|origin|referer|set-cookie|te|trailer|transfer-encoding|upgrade|via|proxy-.+|sec-.+)$/i;

const abortError = () => new DOMException('The upload was cancelled.', 'AbortError');

/** ينتظر مدة ثم يكمل، أو يرفض فوراً مع الإلغاء فلا يبقى مؤقت معلّق بعد إغلاق الصفحة. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((done, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      done();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type UploadScope = { companyId: string; businessId: string; branchId?: string };

async function requestTicket(
  { companyId, businessId, branchId }: UploadScope,
  file: File,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw abortError();
  const result = await apiClient().POST('/v1/businesses/{businessId}/files/uploads', {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body: {
      owner_module: 'customers',
      owner_entity_id: businessId,
      ...(branchId ? { branch_id: branchId } : {}),
      content_type: XLSX,
      size_bytes: file.size,
      required_permission: 'read:files:business',
    },
    ...(signal ? { signal } : {}),
  });
  if (result.error) throw result.error;
  return fileUploadTicket.parse(result.data);
}

async function putBytes(
  ticket: Awaited<ReturnType<typeof requestTicket>>,
  file: File,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw abortError();
  const signedHeaders = Object.entries(ticket.headers).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && !browserManagedHeader.test(entry[0]),
  );
  const put = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: Object.fromEntries(signedHeaders),
    body: file,
    ...(signal ? { signal } : {}),
  });
  if (!put.ok) throw failure('STORAGE_UNAVAILABLE');
}

async function confirm(companyId: string, fileId: string, signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
  const result = await apiClient().POST('/v1/files/{id}/confirm', {
    params: { header: { 'x-company-id': companyId }, path: { id: fileId } },
    ...(signal ? { signal } : {}),
  });
  if (result.error) throw result.error;
}

async function awaitReady(
  companyId: string,
  fileId: string,
  wait: (ms: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  // الفحص يتم في worker؛ ننتظر حتى دقيقة قبل أن نطلب من المدير المحاولة مرة أخرى.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const result = await apiClient().GET('/v1/files/{id}', {
      params: { header: { 'x-company-id': companyId }, path: { id: fileId } },
      ...(signal ? { signal } : {}),
    });
    if (result.error) throw result.error;
    const current = fileStatus.parse(result.data);
    if (current.status === 'READY') return;
    if (current.status === 'REJECTED')
      throw failure(current.rejection_code ?? 'FILE_CONTENT_INVALID');
    await wait(1000, signal);
    if (signal?.aborted) throw abortError();
  }
  throw failure('FILE_NOT_READY');
}

/**
 * يرفع مصنف استيراد العملاء عبر مسار الملفات الموقّع: تذكرة، ثم بايتات، ثم تأكيد، ثم انتظار READY.
 *
 * @param options.companyId الشركة المستهدفة
 * @param options.businessId النشاط الذي يملك الملف
 * @param options.branchId   الفرع حين يكون الاستيراد على فرع واحد
 * @param options.file       المصنف المختار
 * @param options.wait       الانتظار بين محاولات فحص الحالة (للاختبار)
 * @param options.signal     إشارة الإلغاء؛ عند إلغائها يتوقف الفحص فوراً
 * @returns معرّف الملف الجاهز للمعاينة
 */
export async function uploadCustomerImportFile(options: {
  companyId: string;
  businessId: string;
  branchId?: string;
  file: File;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}): Promise<string> {
  const { companyId, businessId, branchId, file, signal } = options;
  const scope: UploadScope = { companyId, businessId, ...(branchId ? { branchId } : {}) };
  const ticket = await requestTicket(scope, file, signal);
  await putBytes(ticket, file, signal);
  await confirm(companyId, ticket.id, signal);
  await awaitReady(companyId, ticket.id, options.wait ?? pause, signal);
  return ticket.id;
}
