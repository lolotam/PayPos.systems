import type {
  CommissionStatementExportData,
  CommissionStatementExportReader,
} from '../../ports/commission-statement-export.port.ts';

/** طلب التصدير مش موجود في المستأجر؛ الرندر ما يقراش أي كشف بدونه (CM-55d). */
export class CommissionStatementExportRequestMissing extends Error {
  readonly code = 'COMMISSION_STATEMENT_EXPORT_REQUEST_MISSING';

  constructor() {
    super('COMMISSION_STATEMENT_EXPORT_REQUEST_MISSING');
  }
}

/** تخزين الصرف غير موجود في هذا الإصدار؛ ملف مدفوع ما يطلعش ناقص عمود الكاش المطلوب. */
export class CommissionStatementPaymentDataUnavailable extends Error {
  readonly code = 'COMMISSION_STATEMENT_PAYMENT_DATA_UNAVAILABLE';

  constructor() {
    super('COMMISSION_STATEMENT_PAYMENT_DATA_UNAVAILABLE');
  }
}

/** يقرأ طلب تصدير كشف العمولة ونطاقه المحفوظ قبل بناء الملف. */
export class ReadCommissionStatementExport {
  constructor(private readonly reader: CommissionStatementExportReader) {}

  async execute(
    companyId: string,
    renderId: string,
    signal?: AbortSignal,
  ): Promise<CommissionStatementExportData> {
    const data = await this.reader.read(companyId, renderId, signal);
    if (data === null) throw new CommissionStatementExportRequestMissing();
    if (data.request.statementStatus === 'PAID') {
      throw new CommissionStatementPaymentDataUnavailable();
    }
    return data;
  }
}
