'use client';
import { useState, type RefObject } from 'react';
import type { UnresolvedTip } from '../api/use-record-session-tips';

// المحاولة المعلقة بتعيش مع الصفحة. تغيير الشركة أو الفرع أو المشغّل بس هو اللي يمسحها، مش فلتر اليوم.
export function useTipAttemptMemory(
  companyId: string,
  businessId: string,
  branchId: string,
  userId: string,
): RefObject<Map<string, UnresolvedTip>> {
  const scopeIdentity = `${companyId}:${businessId}:${branchId}:${userId}`;
  const [attempts] = useState(() => ({ current: new Map<string, UnresolvedTip>() }));
  const [seen, setSeen] = useState(scopeIdentity);
  if (seen !== scopeIdentity) {
    setSeen(scopeIdentity);
    attempts.current.clear();
  }
  return attempts;
}
