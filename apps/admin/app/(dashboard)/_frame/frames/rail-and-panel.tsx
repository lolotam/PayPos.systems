'use client';

import { ContextPanel, NavRail } from '@pospay/ui';
import type { RefObject } from 'react';

import type { StyleCView } from '../menu/style-views';
import { FrameChrome } from './frame-chrome';
import { useFrameLabels } from './use-frame-labels';
import type { PanelState } from './use-panel-state';

/** شريط مساحات العمل ولوحة صفحاتها في النمط C، داخل حد تنقّل الإطار (اللوحة الطافية في portal). */
export function RailAndPanel({
  view,
  visibleIds,
  panel,
  openerRef,
  returnFocusRef,
}: {
  view: StyleCView;
  visibleIds: readonly string[];
  panel: PanelState;
  openerRef: RefObject<HTMLButtonElement | null>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const labels = useFrameLabels();
  return (
    <FrameChrome onCurrentPage={panel.closeFloating}>
      <div className="sticky top-0 hidden h-dvh min-[600px]:flex">
        <NavRail
          workspaces={view.workspaces}
          labels={labels.chrome}
          currentWorkspaceId={view.currentWorkspaceId}
          inspectedWorkspaceId={panel.inspectedId}
          visiblePageIds={visibleIds}
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
        visiblePageIds={visibleIds}
        openerRef={openerRef}
        returnFocusRef={returnFocusRef}
        onInspect={panel.inspectOnly}
        onClose={panel.hide}
      />
    </FrameChrome>
  );
}
