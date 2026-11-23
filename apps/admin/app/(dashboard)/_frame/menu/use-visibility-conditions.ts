'use client';

import { useMemo } from 'react';

import { useSessionUser } from '@/session/api/use-session';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useMounted } from '@/shared/browser/use-mounted';

import { useVisibilityReads, type VisibilityReads } from './use-visibility-reads';
import type { VisibilityConditions } from './visible-page-ids';

/** كل شرط ظهور قديم من حالة قراءته، بنفس القواعد التي كانت في ملفات *-nav-item.tsx. */
function conditionsOf(reads: VisibilityReads): VisibilityConditions {
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
  const keys = Object.values(next);
  // الكائن يُعاد بنفس هويته ما دامت قيمه المنطقية السبع لم تتغير، فلا يُعاد حساب القوائم بلا داعٍ.
  return useMemo(() => next, keys);
}
