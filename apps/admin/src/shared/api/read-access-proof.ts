import type { UseQueryResult } from '@tanstack/react-query';

/**
 * العرض يبدأ بعد نجاح قراءة الخادم للمراقب الحالي. رفض أحدث قراءة يوقف العرض فورًا.
 * قراءة أوقفها انقطاع الاتصال قبل أن تجيب تُعدّ فشلًا لا انتظارًا: جوابها لسه مش موجود، والنجاح
 * المخزَّن من زيارة سابقة ما يقدّمش إثبات لهذه القراءة.
 */
export function readAccessProof(
  query: Pick<
    UseQueryResult<unknown, unknown>,
    'isError' | 'error' | 'isSuccess' | 'isFetchedAfterMount' | 'fetchStatus'
  >,
): 'pending' | 'granted' | 'refused' | 'failed' {
  if (query.fetchStatus === 'paused' && !query.isFetchedAfterMount) return 'failed';
  if (query.isError) {
    const error: unknown = query.error;
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    return status === 401 || status === 403 ? 'refused' : 'failed';
  }
  return query.isSuccess && query.isFetchedAfterMount ? 'granted' : 'pending';
}
