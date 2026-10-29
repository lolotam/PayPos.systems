import { DOCUMENT_XLSX_MIME_TYPE } from '@pospay/contracts';
import { buildCommissionStatementWorkbook } from '@pospay/documents';

import type { CommissionStatementExportData } from '../../modules/commissions/index.ts';
import type { BytesDocumentSource } from '../source-registry.ts';
import { commissionStatementLabels } from './commission-statement-labels.ts';

export interface CommissionStatementSourceDeps {
  readonly readExport: (
    companyId: string,
    renderId: string,
    signal?: AbortSignal,
  ) => Promise<CommissionStatementExportData>;
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
      const data = await deps.readExport(companyId, renderId, signal);
      signal?.throwIfAborted();
      return buildCommissionStatementWorkbook({
        language: data.request.language,
        labels: commissionStatementLabels(data.request.language),
        rows: data.rows,
        paidCash: data.paidCash,
      });
    },
  };
}
