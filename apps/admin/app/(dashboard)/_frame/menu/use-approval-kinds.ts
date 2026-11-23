'use client';

import { useSessionIdentity } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import {
  approvalAccessOf,
  approvalStateOf,
  useApprovalKindProbes,
  type ApprovalProbeState,
} from '@/staff/api/use-approval-kind-access';
import { useWorkspace } from '@/workspace/model/workspace-provider';

import { buildApprovalKinds, type ApprovalKindItem } from './approval-kinds';
import { useMenuContext } from './use-menu-context';

/**
 * أنواع الاعتماد التي يستطيع المستخدم فتح صفحتها الآن مع حال التحقق منها، للصفحة التي ستضيفها 7b.
 * الفرع المستعمل هو فرع مساحة العمل ثم أول فرع للنشاط، كما تفعل مساراتا الحضور.
 * بلا نطاق يتبع الحال مساحة العمل والهوية: ينتظر حتى تصلا، ويفشل إن فشلت إحداهما، حتى لا يُعرض فراغ
 * يوحي بأن لا قائمة متاحة والحقيقة أن المساحة أو الهوية لم تُقرأ.
 */
export function useApprovalInbox(): { kinds: ApprovalKindItem[]; state: ApprovalProbeState } {
  const ctx = useMenuContext();
  const { userId, status: identity } = useSessionIdentity(useMounted());
  const workspace = useWorkspace();
  const business = workspace.status === 'ready' ? workspace.business : undefined;
  const companyId = workspace.status === 'ready' ? workspace.company.id : undefined;
  const branchId =
    workspace.status === 'ready' ? (workspace.branch ?? business?.branches[0])?.id : undefined;
  const scope =
    companyId !== undefined && business && userId !== null
      ? { companyId, businessId: business.id, branchId, userId }
      : null;
  const probes = useApprovalKindProbes(scope);
  const failed = workspace.status === 'error' || identity === 'failed';
  const waiting = workspace.status === 'loading' || identity === 'pending';
  const withoutScope = failed ? 'failed' : waiting ? 'loading' : 'settled';
  return {
    kinds: buildApprovalKinds(ctx, approvalAccessOf(probes)),
    state: scope === null ? withoutScope : approvalStateOf(probes),
  };
}

export function useApprovalKinds(): ApprovalKindItem[] {
  return useApprovalInbox().kinds;
}
