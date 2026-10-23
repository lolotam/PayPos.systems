'use client';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { SessionServiceScope } from '../api/use-session-services';

const SESSION_QUERY_PREFIXES = new Set([
  'session-recording-context',
  'session-performer-context',
  'session-performer-facts',
  'session-performers',
  'session-services',
  'own-recordings',
  'branch-day-sessions',
  'service-line-edits',
  'service-session-capabilities',
  'service-line-cancellations',
  'service-line-performer-changes',
  'session-tips',
]);

function sessionQueriesOf({ companyId, businessId, branchId, userId }: SessionServiceScope) {
  return ({ queryKey: [prefix, company, business, branch, user] }: Query) =>
    SESSION_QUERY_PREFIXES.has(String(prefix)) &&
    company === companyId &&
    business === businessId &&
    branch === branchId &&
    user === userId;
}

// قراءات الشاشة (الصلاحية والحد والأسعار وحقائق المؤديات) بتتخزن 30 ثانية، والسياق المؤرخ للأبد.
// تغيير الهوية أو النطاق بيعيد تركيب الشاشة، فبيات النطاق القديم بتتشال عشان الرجوع ليه يتراجع من السيرفر؛
// ورجوع الاتصال بعد انقطاع حقيقي (false → true) بيعلّمها قديمة عشان اللي اتغير وقت الانقطاع يتقري تاني.
export function useSessionQueryLifecycle(scope: SessionServiceScope, connectivity: boolean | null) {
  const client = useQueryClient();
  const { companyId, businessId, branchId, userId } = scope;
  const previous = useRef(connectivity);
  useEffect(
    () => () => {
      client.removeQueries({
        predicate: sessionQueriesOf({ companyId, businessId, branchId, userId }),
      });
    },
    [client, companyId, businessId, branchId, userId],
  );
  useEffect(() => {
    const reconnected = previous.current === false && connectivity === true;
    previous.current = connectivity;
    if (reconnected)
      void client.invalidateQueries({
        predicate: sessionQueriesOf({ companyId, businessId, branchId, userId }),
      });
  }, [client, connectivity, companyId, businessId, branchId, userId]);
}
