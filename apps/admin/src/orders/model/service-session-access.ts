// TanStack بيفضل محتفظ بآخر صفحة ناجحة جنب الخطأ؛ 403 و FEATURE_DISABLED لازم يقفلو الشاشة عشان الأسماء والأسعار ما تفضلش ظاهرة.
export function serviceSessionAccessRevoked(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const body = error as { status?: unknown; code?: unknown };
  return body.status === 403 || body.code === 'FEATURE_DISABLED';
}
