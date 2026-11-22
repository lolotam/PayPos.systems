'use client';

import { BottomNav } from '@pospay/ui';

import type { StyleAView } from '../menu/style-views';
import { MoreSheet } from './more-sheet';
import { useFrameLabels } from './use-frame-labels';
import { useRouteScopedState } from './use-route-scoped-state';

/**
 * الشريط السفلي لهاتف النمط A: أربعة أقسام و«المزيد» الذي يفتح ورقة بقية الأقسام.
 * فتح الورقة حالة عابرة تُمحى عند كل تغيّر في المسار، فلا تعود مفتوحة عند الرجوع.
 */
export function PhoneBar({ view, pathname }: { view: StyleAView; pathname: string }) {
  const labels = useFrameLabels();
  const [moreOpen, setMoreOpen] = useRouteScopedState(pathname, false);
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 min-[600px]:hidden">
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        groups={view.more}
        title={labels.more}
        closeLabel={labels.chrome.close}
        currentPageId={view.currentPageId}
      />
      <BottomNav
        items={view.bottom}
        labels={labels.bottom}
        extra={{ id: 'more', label: labels.more, onPress: () => setMoreOpen(true) }}
      />
    </div>
  );
}
