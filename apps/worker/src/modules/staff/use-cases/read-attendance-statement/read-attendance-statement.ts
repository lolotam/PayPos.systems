import type { AttendanceStatementRead } from '../../domain/attendance-statement-data.ts';
import { assembleAttendanceStatement } from '../../domain/assemble-attendance-statement.ts';
import type { StatementInputsReader } from '../../ports/attendance-statement.port.ts';

/** طلب البيان مش موجود؛ الرندر ما ينفعش يطلّع لحد (FR-012). */
export class AttendanceStatementRequestMissing extends Error {
  /** رمز العجز الثابت؛ مفيش أي معرف في الرسالة. */
  readonly code = 'ATTENDANCE_STATEMENT_REQUEST_MISSING';

  constructor() {
    super('ATTENDANCE_STATEMENT_REQUEST_MISSING');
  }
}

/**
 * يقرأ كشف الحضور الرسمي: مدخلات الطلب في معاملة واحدة، وبعدها الأرقام من packages/domain.
 * TODO(spec): issue #552 — الأرقام بتتقرا بحالتها وقت الرندر مش وقت الطلب؛ تثبيت المدخلات عند الطلب قرار تصميم لسه ما اتاخدش.
 */
export class ReadAttendanceStatement {
  constructor(private readonly inputs: StatementInputsReader) {}

  /**
   * بيقرا طلب البيان ومدخلاته، وبعدها بيحسب أرقام البيان.
   *
   * @param companyId الشركة
   * @param renderId معرف الرندر وهو معرف صف الطلب
   * @param signal إلغاء المهلة
   * @returns البيان جاهز بأرقامه أو فاضي
   */
  async execute(
    companyId: string,
    renderId: string,
    signal?: AbortSignal,
  ): Promise<AttendanceStatementRead> {
    const inputs = await this.inputs.read(companyId, renderId, signal);
    if (inputs === null) throw new AttendanceStatementRequestMissing();
    return assembleAttendanceStatement(inputs);
  }
}
