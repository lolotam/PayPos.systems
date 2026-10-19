// TanStack بيفضل محتفظ بآخر صفحة ناجحة جنب الخطأ؛ 401 و 403 و FEATURE_DISABLED لازم يقفلو الشاشة عشان الأسماء والأسعار ما تفضلش ظاهرة.
export function serviceSessionAccessRevoked(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const body = error as { status?: unknown; code?: unknown };
  return body.status === 401 || body.status === 403 || body.code === 'FEATURE_DISABLED';
}

// رفض التعديل العادي (403) بيسيب قائمة اليوم ظاهرة؛ 401 أو إيقاف الميزة (بأي status) بيقفل الوصول نفسه زي قراءة اليوم.
export function editAccessRevoked(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const body = error as { status?: unknown; code?: unknown };
  return body.status === 401 || body.code === 'FEATURE_DISABLED';
}

// 403 من الإكرامية لوحده رفض للزر، مش فقدان لقائمة اليوم. 401 وإيقاف الميزة يفضلوا فقدان وصول.
export function tipPermissionRefused(error: unknown): boolean {
  if (editAccessRevoked(error)) return false;
  if (typeof error !== 'object' || error === null) return false;
  return (error as { status?: unknown }).status === 403;
}
