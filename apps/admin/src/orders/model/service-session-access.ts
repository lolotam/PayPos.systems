// TanStack بيفضل محتفظ بآخر صفحة ناجحة جنب الخطأ؛ 401 و 403 و FEATURE_DISABLED لازم يقفلو الشاشة عشان الأسماء والأسعار ما تفضلش ظاهرة.
export function serviceSessionAccessRevoked(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const body = error as { status?: unknown; code?: unknown };
  return body.status === 401 || body.status === 403 || body.code === 'FEATURE_DISABLED';
}

// مسح الكاش من تحت مراقب شغال كان بيخلّي TanStack يبني استعلام فاضي ويطلبه من غير زر.
// القفل بيتساب على مفتاح القراءة لحد نجاحه، فتغيير التاريخ أو التأخير ما يخبّيش مفتاح ناجح تاني.
export function serviceSessionDenial(latchedKey: string | null, viewKey: string, revoked: boolean, succeeded: boolean) {
  const denied = revoked || (latchedKey === viewKey && !succeeded);
  const nextKey = denied ? viewKey : latchedKey === viewKey ? null : latchedKey;
  return { denied, nextKey };
}
