'use client';

import { useCallback, useState } from 'react';

/**
 * حالة عابرة تُمحى عند كل تغيّر في المسار، للأمام وللخلف.
 * مقارنة المسار المحفوظ بالحالي لا تكفي: الرجوع إلى الصفحة الأولى بعد صفحة ثانية كان سيطابق المسار
 * القديم ويُعيد فتح ما فُتح هناك، لذلك تُعاد الحالة المخزنة نفسها إلى قيمتها الأولى أثناء الرسم
 * بالنمط الذي توثّقه React لتصفير الحالة عند تغيّر مدخل.
 */
export function useRouteScopedState<T>(
  pathname: string,
  initial: T,
): readonly [T, (next: T) => void] {
  const [state, setState] = useState({ pathname, value: initial });
  if (state.pathname !== pathname) setState({ pathname, value: initial });
  const value = state.pathname === pathname ? state.value : initial;
  const set = useCallback((next: T) => setState({ pathname, value: next }), [pathname]);
  return [value, set];
}
