import type { AttendanceReportCsv, AttendanceReportRequest, AttendanceReportTransactions } from '../../ports/attendance-report.port.ts';

// يصدر تقرير الحضور المصرح به ويسجل التنزيل قبل إرجاع الملف للقارئ.
export class ExportAttendanceReportUseCase {
  constructor(private readonly transactions: AttendanceReportTransactions, private readonly csv: AttendanceReportCsv) {}

  execute(request: AttendanceReportRequest): Promise<string> {
    return this.transactions.run(request, async (context) => {
      const content = this.csv.render(context.report);
      await context.recordDownload();
      return content;
    });
  }
}
