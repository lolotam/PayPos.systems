'use client';

import { LocalNav, TopNav } from '@pospay/ui';
import { useMemo, type ReactNode } from 'react';

import { useMenuContext } from '../menu/use-menu-context';
import { buildStyleBView } from '../menu/style-views';
import { FrameActions } from './frame-actions';
import { FrameChrome } from './frame-chrome';
import { FrameWorkspaceSwitcher } from './frame-workspace-switcher';
import { useFrameLabels } from './use-frame-labels';

/**
 * النمط B: شريط علوي بوحدات وقوائم واسعة. قائمة الوحدة الحالية المحلية بجانب الصفحة من 1024px
 * (240px عند بداية السطر) وشريط أفقي فوق الصفحة بين 700 و1023px؛ على الهاتف تحل محلها الدرج.
 * الشريط العلوي يبقى مركّبًا بين الصفحات ويُغلق منيوه ودرجه بمفتاح المسار، فلا يفقد تمرير الشريط ولا أصل التركيز.
 */
export function StyleBFrame({ children }: { children: ReactNode }) {
  const labels = useFrameLabels();
  const ctx = useMenuContext();
  const view = useMemo(() => buildStyleBView(ctx), [ctx]);
  const currentModule = view.modules.find((item) => item.id === view.currentModuleId);
  return (
    <div className="flex min-h-dvh flex-col">
      <FrameChrome>
        <div className="flex items-center border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
          <div className="min-w-0 flex-1">
            <TopNav
              modules={view.modules}
              labels={labels.chrome}
              currentModuleId={view.currentModuleId}
              activePageId={view.activePageId}
              visiblePageIds={ctx.visibleIds}
              localNav="none"
              resetKey={ctx.pathname}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 px-2">
            <FrameWorkspaceSwitcher />
            <FrameActions />
          </div>
        </div>
      </FrameChrome>
      <div className="flex min-w-0 flex-1 flex-col min-[1024px]:flex-row">
        {currentModule ? (
          <FrameChrome>
            <LocalNav
              module={currentModule}
              labels={labels.chrome}
              activePageId={view.activePageId}
              visiblePageIds={ctx.visibleIds}
            />
          </FrameChrome>
        ) : null}
        <main className="min-w-0 flex-1 px-4 py-6 min-[768px]:px-6">{children}</main>
      </div>
    </div>
  );
}
