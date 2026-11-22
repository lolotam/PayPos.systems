'use client';

import { useSessionUser } from '@/session/api/use-session';
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
 * بلا نطاق (مساحة العمل أو الجلسة لم تصلا بعد) يبقى الحال «ينتظر» حتى لا يُعرض فراغ قبل أوانه.
 */
export function useApprovalInbox(): { kinds: ApprovalKindItem[]; state: ApprovalProbeState } {
  const ctx = useMenuContext();
  const userId = useSessionUser(useMounted());
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
  const waiting = scope === null && (workspace.status === 'loading' || userId === null);
  return {
    kinds: buildApprovalKinds(ctx, approvalAccessOf(probes)),
    state: waiting ? 'loading' : approvalStateOf(probes),
  };
}

export function useApprovalKinds(): ApprovalKindItem[] {
  return useApprovalInbox().kinds;
}
