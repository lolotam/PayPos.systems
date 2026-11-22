import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CollapsibleSidebar,
  ContextPanel,
  DirectionProvider,
  NavRail,
  PageFinder,
  TopNav,
  type ContextPanelLabels,
  type NavigationChromeLabels,
  type NavigationFinderLabels,
  type NavigationGroup,
  type NavigationModule,
  type NavigationWorkspace,
} from '@pospay/ui';

import './fixture.css';

const params = new URLSearchParams(window.location.search);
const dir = params.get('dir') === 'ltr' ? 'ltr' : 'rtl';
const scene = params.get('scene') ?? 'top';
const finderHideFirst = params.get('finderHideFirst') === 'true';
if (finderHideFirst) document.body.classList.add('fixture-hide-finder-first');

const chromeLabels: NavigationChromeLabels = {
  navigation: 'التنقل',
  openMenu: 'افتح القائمة',
  close: 'إغلاق',
  overview: 'نظرة عامة',
  localNavigation: 'التنقل المحلي',
  expand: 'توسيع الشريط الجانبي',
  collapse: 'طي الشريط الجانبي',
  drawerOpen: 'افتح التنقل',
  drawerTitle: 'الوحدات',
  inspect: 'عرض',
  hidePanel: 'إخفاء اللوحة',
  current: 'الحالي',
};

const contextLabels: ContextPanelLabels = {
  navigation: 'أقسام مساحة العمل',
  close: 'إغلاق اللوحة',
  empty: 'لا توجد صفحات',
  filterPages: 'تصفية هذه القائمة',
};

const finderLabels: NavigationFinderLabels = {
  trigger: 'ابحث عن صفحة',
  title: 'ابحث عن صفحة',
  search: 'ابحث في الصفحات',
  close: 'أغلق البحث',
  empty: 'لا توجد نتائج',
  current: 'الحالي',
};

const page = (id: string, label: string, href: string) => ({ id, label, href });

const groups: readonly NavigationGroup[] = [
  {
    id: 'reports',
    label: 'التقارير التفصيلية اليومية والمؤشرات التشغيلية',
    href: '#reports',
    count: '12',
    pages: [page('summary', 'ملخص الأداء التفصيلي', '#summary')],
  },
  {
    id: 'inventory',
    label: 'إدارة المخزون والتقارير التفصيلية',
    href: '#inventory',
    pages: [page('stock', 'أصناف المخزون المتاحة', '#stock')],
  },
  {
    id: 'customers',
    label: 'العملاء والفواتير والمدفوعات',
    href: '#customers',
    pages: [page('clients', 'قائمة العملاء النشطين', '#clients')],
  },
];

const module = (
  id: string,
  label: string,
  pageId: string,
  pageLabel: string,
): NavigationModule => ({
  id,
  label,
  href: `#${id}`,
  sections: [
    {
      id: `${id}-section`,
      label: 'القسم التفصيلي',
      pages: [page(pageId, pageLabel, `#${pageId}`)],
    },
  ],
});

const modules: readonly NavigationModule[] = [
  module('today', 'اليوم والملخص التشغيلي', 'today-summary', 'ملخص العمليات اليومية التفصيلي'),
  module('sell', 'المبيعات والطلبات اليومية', 'sales-report', 'تقارير الطلبات التفصيلية اليومية'),
  module('stock', 'المخزون وأصناف المنتجات', 'stock-items', 'أصناف المخزون المتاحة'),
  module('grow', 'النمو والتحليلات المتقدمة', 'growth-report', 'تحليلات النمو التفصيلية'),
  module('people', 'الموظفون والفرق', 'employees', 'قائمة الموظفين النشطة'),
  module('business', 'الأعمال والإعدادات', 'columns', 'الأعمدة والتنسيقات المتقدمة'),
];

const workspaces: readonly NavigationWorkspace[] = [
  {
    id: 'business',
    label: 'الأعمال والإعدادات',
    sections: [
      {
        id: 'business-setup',
        label: 'الإعدادات المتقدمة',
        pages: [page('columns', 'الأعمدة والتنسيقات المتقدمة', '#columns')],
      },
    ],
  },
  {
    id: 'customers',
    label: 'العملاء والفواتير',
    sections: [
      {
        id: 'customer-clients',
        label: 'قائمة العملاء',
        pages: [page('clients', 'قائمة العملاء النشطين', '#clients')],
      },
    ],
  },
  {
    id: 'team',
    label: 'الموظفون والفرق',
    sections: [
      {
        id: 'team-people',
        label: 'إدارة الفريق',
        pages: [page('employees', 'قائمة الموظفين النشطة', '#employees')],
      },
    ],
  },
];

function markNavigated() {
  document.body.dataset['navigated'] = 'true';
}

function SidebarScene() {
  return (
    <div className="flex min-h-screen">
      <input data-fixture-outside-input="" aria-label="حقل خارجي" />
      <CollapsibleSidebar
        title={chromeLabels.navigation}
        collapseLabel={chromeLabels.collapse}
        expandLabel={chromeLabels.expand}
        groups={groups}
        currentGroupId="reports"
        currentPageId="summary"
        header={<button type="button">إجراء الرأس</button>}
        footer={<button type="button">إجراء التذييل</button>}
      />
      <main className="min-w-0 flex-1 p-4">
        <h1 className="text-xl font-semibold">التقارير التفصيلية اليومية والمؤشرات التشغيلية</h1>
      </main>
    </div>
  );
}

function TopScene() {
  return (
    <div className="min-h-screen">
      <input data-fixture-outside-input="" aria-label="حقل خارجي" />
      <TopNav
        modules={modules}
        labels={chromeLabels}
        currentModuleId="business"
        activePageId="columns"
        onNavigate={markNavigated}
      />
      <main className="min-w-0 p-4">
        <h1 className="text-xl font-semibold">الأعمدة والتنسيقات المتقدمة</h1>
      </main>
    </div>
  );
}

function ContextScene() {
  const [inspectedWorkspaceId, setInspectedWorkspaceId] = useState<string | undefined>('business');
  const [panelOpen, setPanelOpen] = useState(true);
  return (
    <div className="flex min-h-screen">
      <NavRail
        workspaces={workspaces}
        labels={chromeLabels}
        currentWorkspaceId="business"
        inspectedWorkspaceId={inspectedWorkspaceId}
        panelOpen={panelOpen}
        onInspect={(workspaceId) => {
          setInspectedWorkspaceId(workspaceId);
          setPanelOpen(true);
        }}
      />
      <ContextPanel
        workspaces={workspaces}
        labels={contextLabels}
        currentWorkspaceId="business"
        inspectedWorkspaceId={inspectedWorkspaceId}
        panelOpen={panelOpen}
        activePageId="columns"
        onClose={() => setPanelOpen(false)}
      />
      <main className="min-w-0 flex-1 p-4">
        <PageFinder
          workspaces={workspaces}
          labels={finderLabels}
          activePageId="columns"
          onNavigate={markNavigated}
        />
        <h1 className="mt-4 text-xl font-semibold">الأعمدة والتنسيقات المتقدمة</h1>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('navigation fixture root is missing');

createRoot(root).render(
  <DirectionProvider dir={dir}>
    <div dir={dir} data-fixture-ready="true" data-scene={scene} className="min-h-screen bg-background text-foreground">
      {scene === 'sidebar' ? (
        <SidebarScene />
      ) : scene === 'context' ? (
        <ContextScene />
      ) : (
        <TopScene />
      )}
    </div>
  </DirectionProvider>,
);
