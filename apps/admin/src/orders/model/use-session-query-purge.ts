'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { SessionServiceScope } from '../api/use-session-services';

const SESSION_QUERY_PREFIXES = new Set([
  'session-recording-context', 'session-performer-context', 'session-performer-facts', 'session-performers', 'session-services',
]);

// تغيير الهوية أو النطاق بيعيد تركيب الشاشة؛ الأسماء والأسعار والحدود والتحذيرات المخزّنة للنطاق القديم بتتشال
// عشان الرجوع ليه في مدة staleTime ما يعرضهاش من غير ما الصلاحية تتراجع من السيرفر.
export function useSessionQueryPurge(scope: SessionServiceScope) {
  const client = useQueryClient();
  const { companyId, businessId, branchId, userId } = scope;
  useEffect(() => () => {
    client.removeQueries({ predicate: ({ queryKey: [prefix, company, business, branch, user] }) =>
      SESSION_QUERY_PREFIXES.has(String(prefix)) && company === companyId && business === businessId
        && branch === branchId && user === userId });
  }, [client, companyId, businessId, branchId, userId]);
}
