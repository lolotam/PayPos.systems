'use client';

import { useMemo } from 'react';

import { useInvitationsAccess } from '@/permissions/api/use-invitations-access';
import { useSessionUser } from '@/session/api/use-session';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useMounted } from '@/shared/browser/use-mounted';
import { useWorkspace } from '@/workspace/model/workspace-provider';

import { useVisibilityReads, type VisibilityReads } from './use-visibility-reads';
import type { VisibilityConditions } from './visible-page-ids';

/** نفس الشروط القديمة المنقولة كما هي من ملفات *-nav-item.tsx؛ شرط الدعوات يُضاف في الهوك (spec 076 G1). */
function conditionsOf(reads: VisibilityReads): Omit<VisibilityConditions, 'invitations-owner'> {
  const { open, alerts, rating, identity, planAccess, planEmployees } = reads;
  const { appLink, refunds, ratings, leave, columns } = reads;
  return {
    always: true,
    'alert-rules-or-rating-access': open && (alerts.isSuccess || rating.isSuccess),
    // كما في business-identity-nav-item: قراءة فاشلة بعد نجاح سابق تُخفي المدخل حتى لو بقيت data القديمة true.
    'business-identity-access':
      open && !identity.isPending && !identity.isError && identity.data === true,
    'commission-plans-access': open && planEmployees.data !== undefined && !planAccess.denied,
    'employee-app-link-access': open && appLink.isSuccess,
    'imported-refunds-access': open && readAccessProof(refunds) === 'granted',
    'leave-report-access': open && leave.allowed,
    'ratings-access': open && readAccessProof(ratings) === 'granted',
    'staff-app-columns-access': open && !columns.isPending && !columns.isError,
  };
}

/**
 * يحوّل كل شرط ظهور قديم إلى true أو false باستخدام نفس القراءات التي تستخدمها ملفات
 * *-nav-item.tsx اليوم، بنفس مفاتيح الاستعلام فلا تُرسَل طلبات إضافية.
 * أثناء التحميل أو قبل اختيار نشاط تبقى الشروط مغلقة، فلا تظهر مجموعة فارغة ثم تختفي.
 */
export function useVisibilityConditions(): VisibilityConditions {
  const userId = useSessionUser(useMounted());
  const next = conditionsOf(useVisibilityReads(userId));
  // دعوات الأعضاء للمالك فقط (spec 076 G1): الدور من العضوية المؤكدة في الـ workspace، والقراءة
  // الرخيصة بتأكد إن مسارات الشريحة متاحة أصلاً — البوابة مقفولة (503) تُخفي المدخل بدل صفحة معطوبة.
  // نفس قاعدة القراءات الأخرى: مفيش قراءة قبل اختيار نشاط.
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' && workspace.business !== undefined ? workspace : null;
  // القراءة للمالك وحده: غيره ما يشوفش المدخل أصلاً، فما نبعتش طلب بيرجع 503 والبوابة مقفولة.
  const owner = ready !== null && ready.company.role_code === 'owner';
  const access = useInvitationsAccess(ready?.company.id, userId, owner);
  const invitationsOwner = owner && readAccessProof(access) === 'granted';
  const keys = Object.values(next);
  return useMemo(
    () => ({ ...next, 'invitations-owner': invitationsOwner }),
    [...keys, invitationsOwner],
  );
}
