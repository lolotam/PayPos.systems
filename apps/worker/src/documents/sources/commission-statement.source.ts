import { DOCUMENT_XLSX_MIME_TYPE } from '@pospay/contracts';
import {
  buildCommissionStatementWorkbook,
  type CommissionStatementWorkbookInput,
} from '@pospay/documents';

import {
  CommissionStatementUnavailableError,
  type CommissionStatementUnavailableReason,
} from '../commission-statement-unavailable-error.ts';
import type { BytesDocumentSource } from '../source-registry.ts';
import { commissionStatementLabels } from './commission-statement-labels.ts';

/** شكل بيانات التصدير اللي المصدر بيحتاجه من القارئ، من غير أي ربط بموديول commissions. */
export interface CommissionStatementSourceData {
  readonly request: {
    readonly language: CommissionStatementWorkbookInput['language'];
    readonly scope: CommissionStatementWorkbookInput['scope'];
  };
  readonly rows: CommissionStatementWorkbookInput['rows'];
  readonly employees: CommissionStatementWorkbookInput['employees'];
  readonly paidCash: Exclude<CommissionStatementWorkbookInput['paidCash'], undefined>;
}

export interface CommissionStatementSourceDeps {
  readonly readExport: (
    companyId: string,
    renderId: string,
    signal?: AbortSignal,
  ) => Promise<CommissionStatementSourceData>;
}

// أكواد الفشل الدائم في موديول العمولات؛ المصدر بيشوفها بالرمز عشان طبقة المستندات
// ما تستوردش الموديول، والمصدر بيترجمها لخطأ المستند النهائي اللي ما بيتعادش.
const PERMANENT_FAILURES: Readonly<Record<string, CommissionStatementUnavailableReason>> = {
  COMMISSION_STATEMENT_EXPORT_REQUEST_MISSING: 'REQUEST_MISSING',
  COMMISSION_STATEMENT_PAYMENT_DATA_UNAVAILABLE: 'PAYMENT_DATA_UNAVAILABLE',
};

function permanentReason(error: unknown): CommissionStatementUnavailableReason | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { readonly code?: unknown }).code;
  if (typeof code !== 'string') return null;
  return PERMANENT_FAILURES[code] ?? null;
}

async function readExport(
  deps: CommissionStatementSourceDeps,
  companyId: string,
  renderId: string,
  signal?: AbortSignal,
): Promise<CommissionStatementSourceData> {
  try {
    return await deps.readExport(companyId, renderId, signal);
  } catch (error) {
    const reason = permanentReason(error);
    if (reason === null) throw error;
    throw new CommissionStatementUnavailableError(reason);
  }
}

/**
 * مصدر ملف كشف العمولة: القارئ بيقفل معاملة البيانات المجمّدة الأول، وبعدها
 * ExcelJS بيبني البايتات مباشرة من غير أي مرور على Chromium أو HTML.
 *
 * @param deps قارئ الطلب والصفوف المجمّدة المحقون من composition root
 * @returns مصدر bytes لنوع كشف العمولة
 */
export function createCommissionStatementSource(
  deps: CommissionStatementSourceDeps,
): BytesDocumentSource {
  return {
    output: 'bytes',
    mimeType: DOCUMENT_XLSX_MIME_TYPE,
    async load(companyId, renderId, signal) {
      const data = await readExport(deps, companyId, renderId, signal);
      signal?.throwIfAborted();
      return buildCommissionStatementWorkbook({
        language: data.request.language,
        scope: data.request.scope,
        labels: commissionStatementLabels(data.request.language),
        rows: data.rows,
        employees: data.employees,
        paidCash: data.paidCash,
      });
    },
  };
}
