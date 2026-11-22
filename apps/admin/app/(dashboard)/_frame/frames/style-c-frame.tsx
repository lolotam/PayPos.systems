'use client';

import {
  BottomNav,
  Button,
  ContextPanel,
  NavRail,
  PageFinder,
} from '@pospay/ui';
import { t } from '@pospay/i18n';
import { useMemo, type ReactNode } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

import { useMenuContext } from '../menu/use-menu-context';
import { buildStyleCView } from '../menu/style-views';
import { FrameLinks } from './frame-links';
import { FrameTopBar } from './frame-top-bar';
import { useFrameLabels } from './use-frame-labels';
import { usePanelState } from './use-panel-state';

/** النمط C (الافتراضي): شريط مساحات العمل ولوحة صفحاتها وباحث الصفحات، وعلى الهاتف تبويبات سفلية. */
export function StyleCFrame({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const labels = useFrameLabels();
  const ctx = useMenuContext();
  const view = useMemo(() => buildStyleCView(ctx), [ctx]);
  const panel = usePanelState(ctx.pathname, view.currentWorkspaceId);
  return (
    <FrameLinks>
      <div className="flex min-h-dvh">
        <div className="sticky top-0 hidden h-dvh min-[600px]:flex">
          <NavRail
            workspaces={view.workspaces}
            labels={labels.chrome}
            currentWorkspaceId={view.currentWorkspaceId}
            inspectedWorkspaceId={panel.inspectedId}
            visiblePageIds={ctx.visibleIds}
            panelOpen={panel.open}
            onInspect={panel.inspect}
          />
        </div>
        <ContextPanel
          workspaces={view.workspaces}
          labels={labels.panel}
          currentWorkspaceId={view.currentWorkspaceId}
          inspectedWorkspaceId={panel.inspectedId}
          panelOpen={panel.open}
          activePageId={view.activePageId}
          visiblePageIds={ctx.visibleIds}
          openerRef={panel.openerRef}
          returnFocusRef={panel.returnFocusRef}
          onInspect={panel.inspectOnly}
          onClose={panel.hide}
        />
        <div className="flex min-w-0 flex-1 flex-col pb-16 min-[600px]:pb-0">
          <FrameTopBar
            start={
              <>
                <Button
                  ref={panel.returnFocusRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="hidden min-[600px]:inline-flex"
                  onClick={panel.open ? panel.hide : panel.show}
                >
                  {t(locale, 'adminNav.togglePanel')}
                </Button>
                <PageFinder
                  workspaces={view.workspaces}
                  labels={labels.finder}
                  visiblePageIds={ctx.visibleIds}
                  activePageId={view.activePageId}
                />
              </>
            }
          />
          <main className="min-w-0 flex-1 px-4 py-6 min-[768px]:px-6">{children}</main>
        </div>
      </div>
      <BottomNav
        items={view.bottom}
        labels={labels.workspaceTabs}
        className="fixed inset-x-0 bottom-0 z-30 min-[600px]:hidden"
      />
    </FrameLinks>
  );
}
