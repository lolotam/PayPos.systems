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

/** نتيجة قراءة نوع واحد؛ idle لقراءة لا تعمل لغياب النطاق (مثل غياب الفرع)، فلا تُعدّ انتظارًا. */
export type ApprovalProbe = ReturnType<typeof readAccessProof> | 'idle';

export type ApprovalProbes = Readonly<Record<ApprovalKindId, ApprovalProbe>>;

/** حال الصندوق كله: ينتظر إن بقيت قراءة، أو تعذّر التحقق إن فشلت قراءة (الرفض 401/403 جواب لا فشل). */
export type ApprovalProbeState = 'loading' | 'failed' | 'settled';

function useProbe(
  kind: ApprovalKindId,
  scope: ApprovalAccessScope | null,
  options: { enabled: boolean },
  read: (scope: ApprovalAccessScope, signal: AbortSignal) => Promise<unknown>,
): ApprovalProbe {
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
  const proof = readAccessProof(query);
  // قراءة أوقفها انقطاع الاتصال قبل أن تبدأ ولا بيانات لها تبقى «ينتظر» طوال الانقطاع، فتُعدّ «تعذّر التحقق»
  // وتستأنف وحدها عند عودة الاتصال (networkMode بلا تغيير).
  const pausedWithoutData = query.fetchStatus === 'paused' && query.data === undefined;
  if (!ready) return 'idle';
  return proof === 'pending' && pausedWithoutData ? 'failed' : proof;
}

/**
 * يرفع الخطأ برمز الحالة عند أي رد 4xx/5xx. القرار من رمز الحالة لا من جسم الخطأ: openapi-fetch يعطي
 * error غير معرّف لرد 403 بلا جسم، فلو اعتمدنا عليه لمرّ الرد إلى المحلل وفشل بلا رمز، وقرأه
 * readAccessProof فشلًا بدل رفض.
 */
function rejectOnHttpError(result: { error?: unknown; response: { status: number } }): void {
  if (result.response.status < 400) return;
  throw { ...(result.error as object | undefined), status: result.response.status };
}

const header = (scope: ApprovalAccessScope) => ({ 'x-company-id': scope.companyId });

/**
 * يقول لكل نوع اعتماد هل يستطيع المستخدم فتح صفحته الآن، بنفس القراءة التي تعتمد عليها الصفحة
 * (قائمتها بسجل واحد). الرفض والتحميل والخطأ كلها تعني «لا»، فلا يُخمَّن ظهور نوع لا يُعرف حاله.
 * النوعان الحضوريان يحتاجان فرعًا مختارًا مثل مساريهما.
 * الخطأ يحمل رمز الحالة ليفرّق readAccessProof بين الرفض (401/403: جواب «لا») والفشل (الجواب مجهول).
 * هنا النتيجة الخام لكل قراءة؛ `approvalAccessOf` و`approvalStateOf` يشتقان منها الجواب وحال الصندوق.
 */
export function useApprovalKindProbes(scope: ApprovalAccessScope | null): ApprovalProbes {
  const leave = useProbe(
    'leave-approvals',
    scope,
    { enabled: scope !== null },
    async (s, signal) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/leave-requests', {
        params: { header: header(s), path: { businessId: s.businessId }, query: { limit: 1 } },
        signal,
      });
      rejectOnHttpError(result);
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
      rejectOnHttpError(result);
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
      rejectOnHttpError(result);
      return attendanceExceptionPage.parse(result.data);
    },
  );
  return {
    'leave-approvals': leave,
    'attendance-requests': requests,
    'attendance-exceptions': exceptions,
  };
}

/** جواب نعم/لا لكل نوع: نعم فقط بعد قراءة ناجحة لهذا المراقب. */
export function approvalAccessOf(probes: ApprovalProbes): ApprovalKindAccess {
  return {
    'leave-approvals': probes['leave-approvals'] === 'granted',
    'attendance-requests': probes['attendance-requests'] === 'granted',
    'attendance-exceptions': probes['attendance-exceptions'] === 'granted',
  };
}

export function approvalStateOf(probes: ApprovalProbes): ApprovalProbeState {
  const all = Object.values(probes);
  if (all.includes('pending')) return 'loading';
  return all.includes('failed') ? 'failed' : 'settled';
}

export function useApprovalKindAccess(scope: ApprovalAccessScope | null): ApprovalKindAccess {
  return approvalAccessOf(useApprovalKindProbes(scope));
}
