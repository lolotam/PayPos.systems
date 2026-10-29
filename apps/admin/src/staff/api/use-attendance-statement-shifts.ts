'use client';
import { attendanceStatementShiftOptions, attendanceStatementShiftsQuery } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { StatementPeriod } from '../model/attendance-statement-display';
import type { AttendanceStatementScope } from './use-attendance-statement-request';

/**
 * يقرأ أزواج الشيفتات الموجودة في الفترة (FR-001a) — نفس قراءة بعد ما الـ API اتزود.
 * القراءة دي هي كمان فحص الوصول للشاشة: رفضها معناه إن الصلاحية على الفرع راحت.
 */
export function useAttendanceStatementShifts(
  scope: AttendanceStatementScope,
  period: StatementPeriod,
  enabled = true,
) {
  const { companyId, businessId, branchId, userId } = scope;
  return useQuery({
    queryKey: [
      'attendance-statement-shifts',
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
      const query = attendanceStatementShiftsQuery.safeParse({ from: period.from, to: period.to });
      if (!query.success) throw new Error('ATTENDANCE_STATEMENT_PERIOD_INVALID');
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-statement-shifts',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, branchId },
            query: query.data,
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceStatementShiftOptions.parse(result.data);
    },
  });
}
