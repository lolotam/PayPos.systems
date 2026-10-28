'use client';
import { attendanceStatementAccepted, attendanceStatementRequest } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export type AttendanceStatementScope = {
  companyId: string;
  businessId: string;
  branchId: string;
  userId: string;
};

/** طلب الكشف: الخادم بيجاوب 202 بمعرف التجهيز، والـ PDF بيتجهز في الخلفية. */
export function useAttendanceStatementRequest(scope: AttendanceStatementScope) {
  const { companyId, businessId, branchId, userId } = scope;
  return useMutation({
    mutationKey: ['attendance-statement-request', companyId, businessId, userId, branchId],
    gcTime: 0,
    retry: false,
    mutationFn: async (body: unknown) => {
      const payload = attendanceStatementRequest.parse(body);
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-statements',
        {
          params: { header: { 'x-company-id': companyId }, path: { businessId, branchId } },
          body: payload,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceStatementAccepted.parse(result.data);
    },
  });
}
