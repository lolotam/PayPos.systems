import { selectCommissionStatementPaidCash } from '../../domain/commission-statement-paid-cash.ts';
import { summarizeCommissionStatement } from '../../domain/commission-statement-totals.ts';
import type {
  CommissionStatementExportData,
  CommissionStatementExportReaderData,
  CommissionStatementExportReader,
} from '../../ports/commission-statement-export.port.ts';

/** طلب التصدير مش موجود في المستأجر؛ الرندر ما يقراش أي كشف بدونه (CM-55d). */
export class CommissionStatementExportRequestMissing extends Error {
  readonly code = 'COMMISSION_STATEMENT_EXPORT_REQUEST_MISSING';

  constructor() {
    super('COMMISSION_STATEMENT_EXPORT_REQUEST_MISSING');
  }
}

/** كشف مدفوع ناقص بيانات الصرف (طريقة الصرف أو صف موظفة شهرها كامل)؛ ملف مدفوع ما يطلعش ناقص عمود الكاش المطلوب. */
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
    const paidCash =
      data.request.statementStatus === 'PAID' ? this.resolvePaidCash(data) : data.paidCash;
    return { ...data, paidCash, employees: summarizeCommissionStatement(data.rows) };
  }

  /** كشف PAID لازم يكون له طريقة صرف، وصرف CASH يقتصر على موظفات الشهر الكامل ويغطي كل موظفة مرئية في الملف. */
  private resolvePaidCash(
    data: CommissionStatementExportReaderData,
  ): CommissionStatementExportReaderData['paidCash'] {
    if (data.request.paidMethod === null) throw new CommissionStatementPaymentDataUnavailable();
    if (data.request.paidMethod !== 'CASH') return data.paidCash;
    if (data.paidCash === null) throw new CommissionStatementPaymentDataUnavailable();
    const { paidCash, missingEmployeeIds } = selectCommissionStatementPaidCash(
      data.rows,
      data.paidCash,
    );
    if (missingEmployeeIds.length > 0) throw new CommissionStatementPaymentDataUnavailable();
    return paidCash;
  }
}
