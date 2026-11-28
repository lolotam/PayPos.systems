'use client';
import { useState, type RefObject } from 'react';
import type { UnresolvedTip } from '../api/use-record-session-tips';

// المحاولة المعلقة بتعيش مع الصفحة. تغيير الشركة أو الفرع أو المشغّل يفتح خريطة جديدة عشان رد متأخر من نطاق قديم ما يمسحش محاولة المشغّل الجديد.
export function useTipAttemptMemory(
  companyId: string,
  businessId: string,
  branchId: string,
  userId: string,
): RefObject<Map<string, UnresolvedTip>> {
  const scopeIdentity = `${companyId}:${businessId}:${branchId}:${userId}`;
  const [state, setState] = useState(() => ({
    scope: scopeIdentity,
    memory: { current: new Map<string, UnresolvedTip>() },
  }));
  if (state.scope !== scopeIdentity) {
    const next = {
      scope: scopeIdentity,
      memory: { current: new Map<string, UnresolvedTip>() },
    };
    setState(next);
    return next.memory;
  }
  return state.memory;
}
