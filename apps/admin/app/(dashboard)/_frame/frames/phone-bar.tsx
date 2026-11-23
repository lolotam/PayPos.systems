'use client';

import { BottomNav } from '@pospay/ui';
import { useEffect, useRef, type RefObject } from 'react';

import type { StyleAView } from '../menu/style-views';
import { FrameChrome } from './frame-chrome';
import { MoreSheet } from './more-sheet';
import { useFrameLabels } from './use-frame-labels';
import { useMediaQuery } from './use-media-query';
import { useRouteScopedState } from './use-route-scoped-state';

const PHONE_QUERY = '(width < 600px)';

// بعد تجاوز عرض الهاتف يختفي زر «المزيد» بـ CSS، فيذهب التركيز إلى رابط القسم الحالي في الشريط الجانبي الظاهر.
// البحث داخل جذر الإطار لا في المستند كله: صفحة أو تخطيط قد يرسمان <aside> قبله فيأخذ رابطه التركيز خطأً.
const visibleSectionLink = (frame: HTMLElement | null) =>
  frame?.querySelector<HTMLElement>('aside a[aria-current="page"]') ??
  frame?.querySelector<HTMLElement>('aside a[href]');

/**
 * الشريط السفلي لهاتف النمط A: أربعة أقسام و«المزيد» الذي يفتح ورقة بقية الأقسام.
 * فتح الورقة حالة عابرة تُمحى عند كل تغيّر في المسار، فلا تعود مفتوحة عند الرجوع، وتُغلق أيضًا
 * عند عبور عرض الهاتف: الشريط وزره يختفيان بـ CSS لكن Radix يُبقي الورقة والغطاء في body فتغطّيان واجهة التابلت.
 * الزر الذي ضُغط يُسجَّل ليعود إليه التركيز، فالضغط قد لا ينقل التركيز إليه.
 */
export function PhoneBar({
  view,
  routeKey,
  frameRef,
}: {
  view: StyleAView;
  routeKey: string;
  frameRef: RefObject<HTMLElement | null>;
}) {
  const labels = useFrameLabels();
  const phone = useMediaQuery(PHONE_QUERY);
  const [moreOpen, setMoreOpen] = useRouteScopedState(routeKey, false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeFocusTarget = () => (phone ? undefined : visibleSectionLink(frameRef.current));
  useEffect(() => {
    if (!phone) setMoreOpen(false);
  }, [phone, setMoreOpen]);
  return (
    <FrameChrome onCurrentPage={() => setMoreOpen(false)}>
      <div className="fixed inset-x-0 bottom-0 z-30 min-[600px]:hidden">
        <MoreSheet
          open={moreOpen && phone}
          onOpenChange={setMoreOpen}
          groups={view.more}
          title={labels.more}
          closeLabel={labels.chrome.close}
          currentPageId={view.currentPageId}
          currentGroupId={view.currentGroupId}
          currentLabel={labels.chrome.current}
          openerRef={openerRef}
          closeFocusTarget={closeFocusTarget}
        />
        <BottomNav
          items={view.bottom}
          labels={labels.bottom}
          extra={{
            id: 'more',
            label: labels.more,
            current: view.more.some((group) => group.id === view.currentGroupId),
            onPress: (event) => {
              openerRef.current = event.currentTarget;
              setMoreOpen(true);
            },
          }}
        />
      </div>
    </FrameChrome>
  );
}
