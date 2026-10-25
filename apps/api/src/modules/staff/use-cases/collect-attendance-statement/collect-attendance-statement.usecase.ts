import { DOCUMENT_PDF_MIME_TYPE } from '@pospay/contracts';

import { statementFilename } from '../../domain/attendance-statement-request.ts';
import { AttendanceStatementError } from '../../domain/errors.ts';
import type {
  DocumentBytesStore,
  StatementCollectTransactions,
  StatementScope,
} from '../../ports/attendance-statement.port.ts';

/** طلب التحميل: نطاق المسار ومعرف المستند. */
export interface CollectStatementInput extends StatementScope {
  renderId: string;
}

/** الملف المسلّم: بايتاته ونوعه واسمه. */
export interface CollectStatementResult {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

// يسلّم كشف الحضور مرة واحدة: بياكل البايتات ويسجّل التنزيل في نفس معاملة الطلب.
export class CollectAttendanceStatementUseCase {
  constructor(
    private readonly transactions: StatementCollectTransactions,
    private readonly store: DocumentBytesStore,
  ) {}

  async execute(input: CollectStatementInput): Promise<CollectStatementResult> {
    const { companyId, userId, businessId, branchId, renderId } = input;
    const result = await this.transactions.run(
      { companyId, userId, businessId, branchId },
      async (context) => {
        const row = await context.binding(renderId);
        if (row === null) throw new AttendanceStatementError('NOT_FOUND');
        const status = await this.store.status(companyId, renderId);
        if (status === null || status.requestedBy !== userId)
          throw new AttendanceStatementError('NOT_FOUND');
        if (status.state === 'CONSUMED' || status.state === 'EXPIRED')
          throw new AttendanceStatementError('EXPIRED');
        if (status.state !== 'READY') throw new AttendanceStatementError('NOT_READY');
        const bytes = await this.store.take(companyId, renderId);
        if (bytes === null) throw new AttendanceStatementError('EXPIRED');
        await context.audit.record({
          entity: 'attendance_statement',
          entityId: renderId,
          action: 'attendance.statement.downloaded',
          after: {
            form: row.form,
            business_id: row.businessId,
            branch_id: row.branchId,
            employee_id: row.employeeId,
            from: row.from,
            to: row.to,
            shift: row.shift,
            language: row.language,
          },
        });
        return {
          bytes,
          mimeType: status.mimeType ?? DOCUMENT_PDF_MIME_TYPE,
          filename: statementFilename(row.form, row.from, row.to),
        };
      },
    );
    // بعد الـ commit: لو فشل التسجيل، الحالة بتفضل READY والبايتات راحت، فبتقرأ منتهية.
    await this.store.markConsumed(companyId, renderId).catch(() => undefined);
    return result;
  }
}
