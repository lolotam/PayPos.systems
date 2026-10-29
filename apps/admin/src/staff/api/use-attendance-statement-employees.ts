'use client';
import { attendanceMonthlyReport } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import {
  statementMonthsInPeriod,
  type StatementEmployee,
  type StatementPeriod,
} from '../model/attendance-statement-display';
import type { AttendanceStatementScope } from './use-attendance-statement-request';

function mergeEmployees(rows: StatementEmployee[]): StatementEmployee[] {
  const merged = new Map<string, StatementEmployee>();
  for (const row of rows) {
    const existing = merged.get(row.employee_id);
    if (!existing) {
      merged.set(row.employee_id, row);
      continue;
    }
    merged.set(row.employee_id, { ...existing, name_ar: existing.name_ar ?? row.name_ar });
  }
  return [...merged.values()].sort((a, b) => a.employee_number - b.employee_number);
}

/**
 * قائمة الموظفات للفترة (PP-74.2): صفوف التقرير الشهري لكل شهر في الفترة، مدموجة بمعرف الموظفة.
 * مالها read بديل بصلاحية أخف، ف employee's report هو المصدر الوحيد المتاح للمدير (قرار 2026-10-28).
 */
export function useAttendanceStatementEmployees(
  scope: AttendanceStatementScope,
  period: StatementPeriod,
  enabled = true,
) {
  const { companyId, businessId, branchId, userId } = scope;
  return useQuery({
    queryKey: [
      'attendance-statement-employees',
      companyId,
      businessId,
      userId,
      branchId,
      period.from,
      period.to,
    ],
    enabled: enabled && Boolean(period.from && period.to),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const months = statementMonthsInPeriod(period);
      const reports = await Promise.all(
        months.map(async (month) => {
          const result = await apiClient().GET(
            '/v1/businesses/{businessId}/branches/{branchId}/attendance-report',
            {
              params: {
                header: { 'x-company-id': companyId },
                path: { businessId, branchId },
                query: { month },
              },
              signal,
            },
          );
          if (result.error) throw { ...result.error, status: result.response.status };
          return attendanceMonthlyReport.parse(result.data);
        }),
      );
      return mergeEmployees(reports.flatMap((report) => report.rows));
    },
  });
}
