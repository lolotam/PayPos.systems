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
 * الأرقام بتتقرا بحالتها وقت التجهيز مش وقت الطلب، وده قرار نهائي (PP-61، issue #552):
 * الكشف بيطبع وقت إصداره وأي تعديل بعد التجهيز بيظهر في كشف جديد بس.
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
