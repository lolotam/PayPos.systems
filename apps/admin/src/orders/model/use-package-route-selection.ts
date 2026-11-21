import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { parsePackageRouteId } from './customer-package-view';

/**
 * بيتحقق من مقطع العميلة وقيمة ?package= من العنوان، ويعطي فتح/قفل التفصيل عبر الاستعلام نفسه
 * عشان زر الرجوع يقفل التفصيل (D-A2). القيم الفاسخ بترجع null من غير أي طلب (FR-A07/CP-02).
 */
export function usePackageRouteSelection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawSelection = searchParams.get('package');
  const entitlementId = parsePackageRouteId(rawSelection);
  const select = useCallback(
    (next: string) => {
      router.push(`?package=${next}`);
    },
    [router],
  );
  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('package');
    const query = params.toString();
    router.push(query === '' ? '?' : `?${query}`);
  }, [router, searchParams]);
  return { entitlementId, hasRawSelection: rawSelection !== null, select, close };
}

/** يربط حالة القايمة من الاستعلام اللانهائي: خطأ/تحميل/فاضي/جاهز، ورسالة الخطأ المناسبة لكل رفض. */
export function packageListState(state: {
  isError: boolean;
  isPending: boolean;
  error: unknown;
  itemCount: number;
}): {
  state: 'loading' | 'empty' | 'ready' | 'error';
  errorMessage: 'notAllowed' | 'notFound' | 'loadFailed' | null;
} {
  if (state.isError) {
    const status =
      typeof state.error === 'object' && state.error !== null && 'status' in state.error
        ? (state.error as { status?: unknown }).status
        : undefined;
    return {
      state: 'error',
      errorMessage: status === 403 ? 'notAllowed' : status === 404 ? 'notFound' : 'loadFailed',
    };
  }
  if (state.isPending) return { state: 'loading', errorMessage: null };
  if (state.itemCount === 0) return { state: 'empty', errorMessage: null };
  return { state: 'ready', errorMessage: null };
}
