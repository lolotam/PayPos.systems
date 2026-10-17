import type { QueryClient } from '@tanstack/react-query';
import type { SessionServiceScope } from '../api/use-session-services';

// TanStack بيفضل محتفظ بآخر صفحة ناجحة جنب الخطأ؛ 401 و 403 و FEATURE_DISABLED لازم يقفلو الشاشة عشان الأسماء والأسعار ما تفضلش ظاهرة.
export function serviceSessionAccessRevoked(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const body = error as { status?: unknown; code?: unknown };
  return body.status === 401 || body.status === 403 || body.code === 'FEATURE_DISABLED';
}

function scopeParts(scope: SessionServiceScope) {
  return [scope.companyId, scope.businessId, scope.branchId, scope.userId] as const;
}

// الصفحة الناجحة بتفضل في الكاش بعد الرفض، ولو إعادة المحاولة فشلت بخطأ عابر الخطأ بيتبدل والبيانات بترجع من غير صلاحية.
export function discardDeniedServiceSessionReads(client: QueryClient, scope: SessionServiceScope) {
  const parts = scopeParts(scope);
  client.removeQueries({ queryKey: ['branch-day-sessions', ...parts] });
  client.removeQueries({ queryKey: ['service-line-edits', ...parts] });
}

export function discardDeniedLineEditHistory(client: QueryClient, scope: SessionServiceScope, sessionId: string, lineId: string) {
  client.removeQueries({ queryKey: ['service-line-edits', ...scopeParts(scope), sessionId, lineId] });
}
