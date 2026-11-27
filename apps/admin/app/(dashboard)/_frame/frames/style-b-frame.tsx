'use client';

import { LocalNav, TopNav } from '@pospay/ui';
import { useMemo, type ReactNode } from 'react';

import { useMenuContext } from '../menu/use-menu-context';
import { buildStyleBView } from '../menu/style-views';
import { DashboardBrandLogo } from './dashboard-brand-logo';
import { FrameBarEnd } from './frame-bar-end';
import { FrameChrome } from './frame-chrome';
import { useFrameLabels } from './use-frame-labels';
import { useNavigationKey } from './use-navigation-key';

/**
 * النمط B: شريط علوي بوحدات وقوائم واسعة. قائمة الوحدة الحالية المحلية بجانب الصفحة من 1024px
 * (240px عند بداية السطر) وشريط أفقي فوق الصفحة بين 700 و1023px؛ على الهاتف تحل محلها الدرج.
 * القائمة المحلية من 1024px تبدأ تحت الشريط (ارتفاعه h-16 في TopNav، أي 4rem، وحدّه السفلي 1px) فارتفاعها الأقصى
 * ما بقي من النافذة بعده، وتلتصق بأعلى النافذة عند التمرير فتتمرر داخل نفسها ولا تطول الصفحة.
 * الشريط العلوي يبقى مركّبًا بين الصفحات ويُغلق منيوه ودرجه بمفتاح المسار، فلا يفقد تمرير الشريط ولا أصل التركيز.
 */
export function StyleBFrame({ children }: { children: ReactNode }) {
  const labels = useFrameLabels();
  const ctx = useMenuContext();
  const navigationKey = useNavigationKey();
  const view = useMemo(() => buildStyleBView(ctx), [ctx]);
  const currentModule = view.modules.find((item) => item.id === view.currentModuleId);
  return (
    <div className="flex min-h-dvh flex-col">
      <FrameChrome>
        <div className="flex flex-wrap items-center border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
          <div className="shrink-0 ps-3 pe-2">
            <DashboardBrandLogo variant="mark" />
          </div>
          <div className="min-w-[3.75rem] flex-1">
            <TopNav
              modules={view.modules}
              labels={labels.chrome}
              currentModuleId={view.currentModuleId}
              activePageId={view.activePageId}
              visiblePageIds={ctx.visibleIds}
              localNav="none"
              resetKey={navigationKey}
            />
          </div>
          <div className="ms-auto min-w-0 px-2 py-2">
            <FrameBarEnd />
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
              className="min-[1024px]:sticky min-[1024px]:top-0 min-[1024px]:max-h-[calc(100dvh-4rem-1px)]"
            />
          </FrameChrome>
        ) : null}
        <main className="min-w-0 flex-1 px-4 py-6 min-[768px]:px-6">{children}</main>
      </div>
    </div>
  );
}
