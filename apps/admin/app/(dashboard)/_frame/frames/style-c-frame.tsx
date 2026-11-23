'use client';

import { BottomNav } from '@pospay/ui';
import { useMemo, useRef, type ReactNode } from 'react';

import { useMenuContext } from '../menu/use-menu-context';
import { buildStyleCView } from '../menu/style-views';
import { FrameChrome } from './frame-chrome';
import { FrameTopBar } from './frame-top-bar';
import { PanelToolbar } from './panel-toolbar';
import { RailAndPanel } from './rail-and-panel';
import { useFrameLabels } from './use-frame-labels';
import { useNavigationKey } from './use-navigation-key';
import { usePanelState } from './use-panel-state';

/** النمط C (الافتراضي): شريط مساحات العمل ولوحة صفحاتها وباحث الصفحات، وعلى الهاتف تبويبات سفلية. */
export function StyleCFrame({ children }: { children: ReactNode }) {
  const labels = useFrameLabels();
  const ctx = useMenuContext();
  const navigationKey = useNavigationKey();
  const view = useMemo(() => buildStyleCView(ctx), [ctx]);
  const openerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const panel = usePanelState(navigationKey, ctx.pathname, view.currentWorkspaceId, openerRef);
  return (
    <>
      <div className="flex min-h-dvh">
        <RailAndPanel
          view={view}
          visibleIds={ctx.visibleIds}
          panel={panel}
          openerRef={openerRef}
          returnFocusRef={returnFocusRef}
        />
        <div className="flex min-w-0 flex-1 flex-col pb-16 min-[600px]:pb-0">
          <FrameTopBar
            start={
              <PanelToolbar
                view={view}
                visibleIds={ctx.visibleIds}
                panelOpen={panel.open}
                routeKey={navigationKey}
                onShow={panel.show}
                onHide={panel.hide}
                toggleRef={returnFocusRef}
              />
            }
          />
          <main className="min-w-0 flex-1 px-4 py-6 min-[768px]:px-6">{children}</main>
        </div>
      </div>
      <FrameChrome>
        <BottomNav
          items={view.bottom}
          labels={labels.workspaceTabs}
          className="fixed inset-x-0 bottom-0 z-30 min-[600px]:hidden"
        />
      </FrameChrome>
    </>
  );
}
