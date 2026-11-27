'use client';

import { CollapsibleSidebar, NavTabs, Pills } from '@pospay/ui';
import { useMemo, useRef, type ReactNode } from 'react';

import { useMenuContext } from '../menu/use-menu-context';
import { buildStyleAView } from '../menu/style-views';
import { DashboardBrandLogo } from './dashboard-brand-logo';
import { FrameChrome } from './frame-chrome';
import { FrameTopBar } from './frame-top-bar';
import { PhoneBar } from './phone-bar';
import { useFrameLabels } from './use-frame-labels';
import { useNavigationKey } from './use-navigation-key';

// عمود الصفحة يتبع عرض الشريط الجانبي: 80px مطويًا أو على التابلت، و264px موسّعًا من 1024px.
// الشريط ثابت ويحمل data-collapsed حين يطوى، فنقرأ ذلك بـ CSS دون نسخ حالته إلى هنا.
const PAGE_COLUMN_CLASS =
  'flex min-h-dvh min-w-0 flex-1 flex-col min-[600px]:ms-20 min-[1024px]:ms-66 min-[1024px]:group-has-[aside[data-collapsed]]:ms-20';

/**
 * النمط A: شريط جانبي بمجموعات وتبويبات للمجموعة الحالية وحبوب للصفحات فوق المحتوى.
 * رأس الشريط يحمل علامة PosPay فقط — من غير اسم — لأنها بتتكرر في الشريط العلوي؛
 * ومبدّل مساحة العمل وقائمة الحساب في الشريط العلوي فتبقى ظاهرة بكل عرض.
 * على الهاتف الشريط السفلي أربعة أقسام و«المزيد».
 */
export function StyleAFrame({ children }: { children: ReactNode }) {
  const labels = useFrameLabels();
  const ctx = useMenuContext();
  const navigationKey = useNavigationKey();
  const frameRef = useRef<HTMLDivElement>(null);
  const view = useMemo(() => buildStyleAView(ctx), [ctx]);
  // صف التبويب الوحيد يُخفى إلا إذا حمل علامة «قريبًا»: هو الرابط المرئي الذي يوصل إلى الصفحة غير المبنية.
  const showTabs = view.tabs.length > 1 || view.tabs.some((tab) => tab.status !== undefined);
  return (
    <>
      <div ref={frameRef} className="group relative flex min-h-dvh">
        <FrameChrome>
          <CollapsibleSidebar
            title={labels.chrome.navigation}
            collapseLabel={labels.chrome.collapse}
            expandLabel={labels.chrome.expand}
            groups={view.groups}
            currentGroupId={view.currentGroupId}
            currentPageId={view.currentPageId}
            header={<DashboardBrandLogo variant="mark" />}
          />
        </FrameChrome>
        <div className={PAGE_COLUMN_CLASS}>
          <FrameTopBar
            start={<DashboardBrandLogo variant="mark" className="min-[600px]:hidden" />}
          />
          {showTabs ? (
            <FrameChrome>
              <NavTabs items={view.tabs} labels={labels.tabs} />
            </FrameChrome>
          ) : null}
          <main className="min-w-0 flex-1 px-4 pt-4 pb-20 min-[600px]:pb-6 min-[768px]:px-6">
            {view.pills.length > 0 ? (
              <FrameChrome>
                <Pills items={view.pills} labels={labels.pills} className="mb-4" />
              </FrameChrome>
            ) : null}
            {children}
          </main>
        </div>
      </div>
      <PhoneBar view={view} routeKey={navigationKey} frameRef={frameRef} />
    </>
  );
}
