'use client';

import { t } from '@pospay/i18n';
import { Button, PageFinder } from '@pospay/ui';
import type { RefObject } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

import type { StyleCView } from '../menu/style-views';
import { useFrameLabels } from './use-frame-labels';

/** بداية الشريط العلوي في النمط C: زر إظهار اللوحة (من 600px) وباحث الصفحات على كل عرض. */
export function PanelToolbar({
  view,
  visibleIds,
  panelOpen,
  onToggle,
  toggleRef,
}: {
  view: StyleCView;
  visibleIds: readonly string[];
  panelOpen: boolean;
  onToggle: () => void;
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
        onClick={onToggle}
      >
        {t(locale, 'adminNav.togglePanel')}
      </Button>
      <PageFinder
        workspaces={view.workspaces}
        labels={labels.finder}
        visiblePageIds={visibleIds}
        activePageId={view.activePageId}
      />
    </>
  );
}
