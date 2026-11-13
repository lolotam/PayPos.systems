'use client';
import {
  leaveHistoryReportAccepted,
  leaveHistoryReportStatus,
  type LeaveHistoryReportAccepted,
  type LeaveHistoryReportStatus,
} from '@pospay/contracts';
import { skipToken, useQuery, type QueryKey } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { LeaveReportBody, LeaveReportScope } from '../model/leave-report-view';

const REPORT_POLL_INTERVAL_MS = 3000;

/** مدة بقاء الطلب المنشور في الكاش بعد إغلاق الشاشة: تكفي لإعادة الفتح من غير طلب تاني. */
export const REPORT_POSTED_GC_MS = 10 * 60 * 1000;

/**
 * مفتاح تشغيل واحد: نفس النطاق ونفس رقم التشغيل ونفس جسم الطلب = نفس المفتاح، فإعادة فتح الشاشة ما بتعملش تقرير تاني.
 */
export function leaveReportPostedKey(
  scope: LeaveReportScope,
  run: number,
  body: LeaveReportBody,
): QueryKey {
  return ['leave-report', scope.companyId, scope.businessId, scope.userId, 'posted', run, body];
}

/**
 * طلب التقرير التقيل: بيرجع رقم التقرير، وأي رفض بيرمي ظرفه زي ما هو عشان الشاشة تعرض رسالته.
 */
export async function postLeaveReport(
  scope: LeaveReportScope,
  body: LeaveReportBody,
): Promise<LeaveHistoryReportAccepted> {
  // الحقل الاختياري بيتسقط بدل ما يبقى undefined، عشان جسم الطلب يفضل مطابق لعميل الـ API المولّد.
  const { branch_id: branchId, ...terms } = body;
  const result = await apiClient().POST('/v1/businesses/{businessId}/leave-history/reports', {
    params: {
      header: { 'x-company-id': scope.companyId },
      path: { businessId: scope.businessId },
    },
    body: { ...terms, ...(branchId ? { branch_id: branchId } : {}) },
  });
  if (result.error) throw { ...result.error, status: result.response.status };
  return leaveHistoryReportAccepted.parse(result.data);
}

/**
 * مراقب الطلب المنشور: هو اللي بيمنع طلب تاني بعد إعادة فتح الشاشة، والخطأ بيتبين من هنا مش من طلب جديد.
 */
export function useLeaveReportPosted(key: QueryKey) {
  return useQuery<LeaveHistoryReportAccepted>({
    queryKey: key,
    queryFn: skipToken,
    enabled: false,
    retry: false,
    staleTime: Infinity,
    gcTime: REPORT_POSTED_GC_MS,
  });
}

/**
 * تشغيل التقرير التقيل: الطلب نفسه منفصل عن قراءة النتيجة، وعليه يبقى في الاستدعاء مش في الـ hook.
 */
export function useLeaveReportJob(
  scope: LeaveReportScope,
  reportId: string | undefined,
  cursor: string | undefined,
  limit: number,
) {
  const result = useQuery<LeaveHistoryReportStatus>({
    queryKey: [
      'leave-report',
      scope.companyId,
      scope.businessId,
      scope.userId,
      'job',
      reportId,
      cursor,
    ],
    enabled: reportId !== undefined,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[5] === reportId ? previous : undefined,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? REPORT_POLL_INTERVAL_MS : false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/leave-history/reports/{reportId}',
        {
          params: {
            header: { 'x-company-id': scope.companyId },
            path: { businessId: scope.businessId, reportId: reportId ?? '' },
            query: { ...(cursor ? { cursor } : {}), limit },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return leaveHistoryReportStatus.parse(result.data);
    },
  });
  return { result };
}
