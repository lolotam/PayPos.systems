'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { STACKED_QUERY, useStackedWidth } from './use-stacked-width';

type Target = 'select' | 'header';

const SELECT_ID = 'report-sort';
const SORTED_HEADER_BUTTON =
  'th[role="columnheader"][aria-sort="ascending"] button, th[role="columnheader"][aria-sort="descending"] button';
const FIRST_HEADER_BUTTON = 'th[role="columnheader"] button';

/**
 * المالك الوحيد لنقل التركيز بين أداتي الفرز عند عبور حدّ 600px، في الاتجاهين:
 * التضييق يزيل أزرار الترويسة فينتقل التركيز منها إلى مربع «الترتيب حسب»، والتوسيع يخفي المربع
 * فينتقل التركيز منه إلى زر عمود الفرز الحالي أو إلى أول زر إن لم يُفرز شيء.
 * يُلتقط مكان التركيز لحظة تغيّر الاستعلام، قبل أن يغيّر المتصفح التركيز بالإخفاء، ويُطبَّق بعد الرسم.
 */
export function useSortFocusHandOver() {
  const stacked = useStackedWidth();
  const pending = useRef<Target | null>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(STACKED_QUERY);
    const onChange = () => {
      const active = document.activeElement;
      if (active?.id === SELECT_ID && !media.matches) pending.current = 'header';
      else if (active?.closest('th[role="columnheader"]') && media.matches) {
        pending.current = 'select';
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  useLayoutEffect(() => {
    const target = pending.current;
    pending.current = null;
    if (target === 'select') document.getElementById(SELECT_ID)?.focus();
    if (target === 'header') {
      const button =
        document.querySelector<HTMLElement>(SORTED_HEADER_BUTTON) ??
        document.querySelector<HTMLElement>(FIRST_HEADER_BUTTON);
      button?.focus();
    }
  }, [stacked]);
}
