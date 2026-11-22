'use client';

import { t } from '@pospay/i18n';
import { Button, PageFinder } from '@pospay/ui';
import type { RefObject } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

import type { StyleCView } from '../menu/style-views';
import { useFrameLabels } from './use-frame-labels';

/**
 * بداية الشريط العلوي في النمط C: زر إظهار اللوحة (من 600px) وباحث الصفحات على كل عرض.
 * الباحث يُعاد بناؤه عند كل مسار جديد فيُغلق ويُمحى بحثه، والزر يعطي المضيف نفسه فاتحًا للوحة.
 */
export function PanelToolbar({
  view,
  visibleIds,
  routeKey,
  panelOpen,
  onShow,
  onHide,
  toggleRef,
}: {
  view: StyleCView;
  visibleIds: readonly string[];
  routeKey: string;
  panelOpen: boolean;
  onShow: (opener: HTMLButtonElement) => void;
  onHide: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
}) {
  const locale = useLocale();
  const labels = useFrameLabels();
  return (
    <>
      <Button
        ref={toggleRef}
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={panelOpen}
        className="hidden min-[600px]:inline-flex"
        onClick={(event) => (panelOpen ? onHide() : onShow(event.currentTarget))}
      >
        {t(locale, 'adminNav.togglePanel')}
      </Button>
      <PageFinder
        key={routeKey}
        workspaces={view.workspaces}
        labels={labels.finder}
        visiblePageIds={visibleIds}
        activePageId={view.activePageId}
      />
    </>
  );
}
