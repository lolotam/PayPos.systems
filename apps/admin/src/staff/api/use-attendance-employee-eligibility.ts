'use client';
import { attendanceEmployeePage, type AttendanceEmployeePage } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useAttendanceActionScope } from './use-attendance-action-scope';
import { attendanceActionKey, attendanceActionParams } from './use-attendance-actions-read';
import type { AttendanceBoardScope } from './use-attendance-board';

type Employee = AttendanceEmployeePage['items'][number];
export function useAttendanceEmployeeEligibility(
  scope: AttendanceBoardScope,
  employee: Employee | undefined,
  date: string | undefined,
  enabled: boolean,
) {
  useAttendanceActionScope(scope, 'employee-eligibility');
  return useQuery({
    queryKey: [
      ...attendanceActionKey(scope),
      'employee-eligibility',
      employee?.id,
      employee?.name_en,
      date,
    ],
    enabled: enabled && Boolean(employee),
    retry: false,
    queryFn: async ({ signal }) => {
      if (!employee) return false;
      let cursor: string | undefined;
      do {
        const result = await apiClient().GET(
          '/v1/businesses/{businessId}/branches/{branchId}/attendance-employees',
          {
            params: {
              ...attendanceActionParams(scope),
              query: {
                limit: 50,
                search: employee.name_en.slice(0, 100),
                ...(date ? { date } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
            signal,
          },
        );
        if (result.error) throw { ...result.error, status: result.response.status };
        const page = attendanceEmployeePage.parse(result.data);
        if (page.items.some((row) => row.id === employee.id)) return true;
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      return false;
    },
  });
}
