import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { parsePackageRouteId } from './customer-package-view';

/**
 * بيتحقق من مقطع العميلة وقيمة ?package= من العنوان، ويعطي فتح/قفل التفصيل عبر الاستعلام نفسه
 * عشان زر الرجوع يقفل التفصيل (D-A2). أول تركيب بيايف القيمة زي ما هي (deep link مباشر)،
 * وتغيير النطاق بيمسح الاختيار فورًا قبل أي طلب تفصيل بالنطاق الجديد، والقيم الفاسخ بترجع null
 * من غير أي طلب (FR-A07/CP-02).
 */
export function usePackageRouteSelection(scopeKey: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawSelection = searchParams.get('package');
  const [activeScope, setActiveScope] = useState(scopeKey);
  useEffect(() => {
    if (activeScope === scopeKey) return;
    setActiveScope(scopeKey);
    if (rawSelection === null) return;
    // نطاق اتبدّل والاختيار لسه في العنوان: مسح فوري قبل ما التفصيل الجديد يطلب أي حاجة.
    const params = new URLSearchParams(searchParams.toString());
    params.delete('package');
    const query = params.toString();
    router.replace(query === '' ? '?' : `?${query}`);
  }, [activeScope, rawSelection, router, scopeKey, searchParams]);
  const selectionLive = activeScope === scopeKey;
  const entitlementId = selectionLive ? parsePackageRouteId(rawSelection) : null;
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
  return { entitlementId, hasRawSelection: rawSelection !== null && selectionLive, select, close };
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
      errorMessage:
        status === 403 || status === 401 ? 'notAllowed' : status === 404 ? 'notFound' : 'loadFailed',
    };
  }
  if (state.isPending) return { state: 'loading', errorMessage: null };
  if (state.itemCount === 0) return { state: 'empty', errorMessage: null };
  return { state: 'ready', errorMessage: null };
}
