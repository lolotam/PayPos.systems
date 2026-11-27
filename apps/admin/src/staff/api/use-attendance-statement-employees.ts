'use client';
import { attendanceStatementEmployeeOptions } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { StatementPeriod } from '../model/attendance-statement-display';
import type { AttendanceStatementScope } from './use-attendance-statement-request';

/**
 * قائمة الموظفات للفترة (issue #703): قراءة واحدة من مسار كشف الحضور نفسه.
 * المسار بيرجّع الموظفات اللي ليها تغطية بس — حتى الموظفة اللي تغطيتها وردية جدولة
 * من غير بصمة — فالمنتقي ما بيعتمدش على قراءة التقرير الشهري لوحدها تاني.
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
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-statement-employees',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, branchId },
            query: { from: period.from, to: period.to },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceStatementEmployeeOptions.parse(result.data).employees;
    },
  });
}
