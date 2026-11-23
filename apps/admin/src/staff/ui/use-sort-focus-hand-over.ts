'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { isStackedWidth, onBeforeStackedChange, useStackedWidth } from './use-stacked-width';

type Target = 'select' | 'header';

const SELECT_ID = 'report-sort';
const HEADER_CELL = 'th[role="columnheader"]';
const FIRST_HEADER_BUTTON = `${HEADER_CELL} button`;

function headerButtonOf(primaryColumnId: string | undefined): HTMLElement | null {
  const cell = Array.from(document.querySelectorAll<HTMLElement>(HEADER_CELL)).find(
    (candidate) =>
      primaryColumnId !== undefined && candidate.dataset['sortColumn'] === primaryColumnId,
  );
  return (
    cell?.querySelector<HTMLElement>('button') ??
    document.querySelector<HTMLElement>(FIRST_HEADER_BUTTON)
  );
}

/**
 * المالك الوحيد لنقل التركيز بين أداتي الفرز عند عبور حدّ 600px، في الاتجاهين:
 * التضييق يزيل أزرار الترويسة فينتقل التركيز منها إلى مربع «الترتيب حسب»، والتوسيع يخفي المربع
 * فينتقل التركيز منه إلى زر عمود الفرز الأول (الذي يعرضه المربع) أو إلى أول زر إن لم يُفرز شيء.
 * ضمان الترتيب: يُلتقط مكان التركيز داخل المستمع الوحيد لتغيّر الاستعلام وقبل إخطار أي مشترك،
 * أي قبل أن يرسم React أو يغيّر المتصفح التركيز بالإخفاء؛ ويُطبَّق في تأثير تخطيط بعد رسم الوضع الجديد.
 *
 * @param primaryColumnId معرّف عمود الفرز الأول؛ غائب إذا لم يُفرز شيء.
 */
export function useSortFocusHandOver(primaryColumnId: string | undefined) {
  const stacked = useStackedWidth();
  const pending = useRef<Target | null>(null);
  useEffect(
    () =>
      onBeforeStackedChange(() => {
        const active = document.activeElement;
        const stackedNow = isStackedWidth();
        if (!stackedNow && active?.id === SELECT_ID) pending.current = 'header';
        else if (stackedNow && active?.closest(HEADER_CELL)) pending.current = 'select';
      }),
    [],
  );
  useLayoutEffect(() => {
    const target = pending.current;
    pending.current = null;
    if (target === 'select') document.getElementById(SELECT_ID)?.focus();
    if (target === 'header') headerButtonOf(primaryColumnId)?.focus();
  }, [stacked, primaryColumnId]);
}
