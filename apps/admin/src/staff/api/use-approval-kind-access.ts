'use client';

import { attendanceChangeRequestPage, attendanceExceptionPage, leavePage } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/shared/api/client';
import { readAccessProof } from '@/shared/api/read-access-proof';

export type ApprovalKindId = 'leave-approvals' | 'attendance-requests' | 'attendance-exceptions';

export interface ApprovalAccessScope {
  companyId: string;
  businessId: string;
  branchId: string | undefined;
  userId: string;
}

export type ApprovalKindAccess = Readonly<Record<ApprovalKindId, boolean>>;

function useProbe(
  kind: ApprovalKindId,
  scope: ApprovalAccessScope | null,
  options: { enabled: boolean },
  read: (scope: ApprovalAccessScope, signal: AbortSignal) => Promise<unknown>,
): boolean {
  const ready = scope !== null && options.enabled;
  const query = useQuery({
    queryKey: [
      'approval-kind-access',
      kind,
      scope?.companyId ?? '',
      scope?.businessId ?? '',
      scope?.branchId ?? '',
      scope?.userId ?? '',
    ],
    enabled: ready,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    // enabled يمنع التشغيل بلا نطاق، فهنا النطاق موجود دائمًا.
    queryFn: ({ signal }) => read(scope as ApprovalAccessScope, signal),
  });
  // إثبات حالي لهذا المراقب: النجاح المخزَّن من زيارة سابقة لا يُظهر نوعًا، فمن سُحبت صلاحيته لا يرى رابطًا يردّ 403.
  return ready && readAccessProof(query) === 'granted';
}

const header = (scope: ApprovalAccessScope) => ({ 'x-company-id': scope.companyId });

/**
 * يقول لكل نوع اعتماد هل يستطيع المستخدم فتح صفحته الآن، بنفس القراءة التي تعتمد عليها الصفحة
 * (قائمتها بسجل واحد). الرفض والتحميل والخطأ كلها تعني «لا»، فلا يُخمَّن ظهور نوع لا يُعرف حاله.
 * النوعان الحضوريان يحتاجان فرعًا مختارًا مثل مساريهما.
 */
export function useApprovalKindAccess(scope: ApprovalAccessScope | null): ApprovalKindAccess {
  const leave = useProbe(
    'leave-approvals',
    scope,
    { enabled: scope !== null },
    async (s, signal) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/leave-requests', {
        params: { header: header(s), path: { businessId: s.businessId }, query: { limit: 1 } },
        signal,
      });
      if (result.error) throw result.error;
      return leavePage.parse(result.data);
    },
  );
  const requests = useProbe(
    'attendance-requests',
    scope,
    { enabled: scope?.branchId !== undefined },
    async (s, signal) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/attendance-change-requests',
        {
          params: {
            header: header(s),
            path: { businessId: s.businessId },
            query: { limit: 1, ...(s.branchId ? { branch_id: s.branchId } : {}) },
          },
          signal,
        },
      );
      if (result.error) throw result.error;
      return attendanceChangeRequestPage.parse(result.data);
    },
  );
  const exceptions = useProbe(
    'attendance-exceptions',
    scope,
    { enabled: scope?.branchId !== undefined },
    async (s, signal) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-exceptions',
        {
          params: {
            header: header(s),
            path: { businessId: s.businessId, branchId: s.branchId ?? '' },
            query: { status: 'OPEN', limit: 1 },
          },
          signal,
        },
      );
      if (result.error) throw result.error;
      return attendanceExceptionPage.parse(result.data);
    },
  );
  return {
    'leave-approvals': leave,
    'attendance-requests': requests,
    'attendance-exceptions': exceptions,
  };
}
