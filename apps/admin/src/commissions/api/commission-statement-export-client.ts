import {
  commissionStatementExportAccepted,
  commissionStatementExportStatus,
  type DocumentRenderErrorCode,
  type DocumentRenderState,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';
import type { StatementScope } from './commission-statement-client';
// قاعدة الرفض واحدة لكل عملاء العمولة: الحالة بتتفحص قبل الجسم عشان 403 بجسم فاضي ما يضيعش.
import { refusal } from './commission-plans-client';

/** لغة ملف الإكسل؛ المستخدم بيختارها في كل طلب ومفيش لغة افتراضية من السيرفر (CS-Q33). */
export type StatementExportLanguage = 'ar' | 'en';

function pathParams(scope: StatementScope, period: string) {
  return { header: { 'x-company-id': scope[1] }, path: { businessId: scope[2], period } };
}

/** بيطلب تصدير كشف شهر مغلق بلغة الملف؛ السيرفر بيرد 202 بمعرّف التجهيز. من غير Idempotency-Key لأن الطلب ما بيكتبش مالياً. */
export async function requestStatementExport(
  scope: StatementScope,
  period: string,
  language: StatementExportLanguage,
): Promise<string> {
  const result = await apiClient().POST(
    '/v1/businesses/{businessId}/commission-statements/{period}/exports',
    { params: pathParams(scope, period), body: { language } },
  );
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionStatementExportAccepted.parse(result.data).render_id;
}

/**
 * حالة تجهيز الملف كما بترجع من السيرفر؛ كود الفشل بيظهر في حالة FAILED بس. معرّفة هنا لأن النوع المستنتج من
 * سكيما العقد بيطلع `{}` (responseObject مكتوب كـ typeof z.object)، فالحقول ما بتبانش للمترجم.
 */
export interface StatementExportStatus {
  readonly state: DocumentRenderState;
  readonly error_code?: DocumentRenderErrorCode;
}

/** بيجيب حالة تجهيز الملف؛ أي render id مش بتاعنا بيرد 404 موحّد. */
export async function fetchStatementExportStatus(
  scope: StatementScope,
  period: string,
  renderId: string,
  signal: AbortSignal,
): Promise<StatementExportStatus> {
  const result = await apiClient().GET(
    '/v1/businesses/{businessId}/commission-statements/{period}/exports/{renderId}',
    {
      params: {
        header: { 'x-company-id': scope[1] },
        path: { businessId: scope[2], period, renderId },
      },
      signal,
    },
  );
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionStatementExportStatus.parse(result.data) as StatementExportStatus;
}

/** رفض التحصيل بيرجع blob، فبنفكّه عشان نعرف كود الرفض. */
async function unpackBlobError(error: unknown, status: number): Promise<unknown> {
  let envelope: unknown = error;
  const blob = error as { text?: () => Promise<string> } | null;
  if (typeof blob?.text === 'function') {
    try {
      envelope = JSON.parse(await blob.text()) as unknown;
    } catch {
      envelope = null;
    }
  }
  return refusal(typeof envelope === 'object' && envelope !== null ? envelope : {}, status);
}

/** بيحمّل الملف مرة واحدة بس (التحصيل بيستهلك المستند) كـ blob. */
export async function downloadStatementExport(
  scope: StatementScope,
  period: string,
  renderId: string,
  signal: AbortSignal,
): Promise<Blob> {
  const result = await apiClient().POST(
    '/v1/businesses/{businessId}/commission-statements/{period}/exports/{renderId}/download',
    {
      params: {
        header: { 'x-company-id': scope[1] },
        path: { businessId: scope[2], period, renderId },
      },
      parseAs: 'blob',
      signal,
    },
  );
  if (!result.response.ok) throw await unpackBlobError(result.error, result.response.status);
  if (!result.data) throw new Error('COMMISSION_STATEMENT_EXPORT_EMPTY_RESPONSE');
  return result.data;
}
