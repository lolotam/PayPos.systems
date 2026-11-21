import type {
  NavigationChromeLabels,
  NavigationFinderLabels,
  NavigationGroup,
  NavigationModule,
  NavigationWorkspace,
  ContextPanelLabels,
} from '../navigation-presentation.js';

export const chromeLabels: NavigationChromeLabels = {
  navigation: 'Navigation',
  openMenu: 'Open menu',
  close: 'Close',
  overview: 'Overview',
  localNavigation: 'Local navigation',
  expand: 'Expand sidebar',
  collapse: 'Collapse sidebar',
  drawerOpen: 'Open navigation',
  drawerTitle: 'Modules',
  inspect: 'Inspect',
  hidePanel: 'Hide panel',
  current: 'Current',
};

export const finderLabels: NavigationFinderLabels = {
  trigger: 'Find a page',
  title: 'Find a page',
  search: 'Search pages',
  close: 'Close finder',
  empty: 'No pages found',
  current: 'Current',
};

export const contextLabels: ContextPanelLabels = {
  navigation: 'Workspace sections',
  close: 'Close panel',
  empty: 'No pages',
};

const page = (id: string, label: string, href: string, status?: string) => ({
  id,
  label,
  href,
  ...(status ? { status } : {}),
});

export const groups: readonly NavigationGroup[] = [
  {
    id: 'home',
    label: 'Home',
    href: '#home',
    count: '2',
    pages: [page('approvals', 'Approvals', '#approvals')],
  },
  { id: 'sales', label: 'Sales', href: '#sales', pages: [page('orders', 'Orders', '#orders')] },
  { id: 'catalog', label: 'Catalog', href: '#catalog', pages: [page('products', 'Products', '#products')] },
  { id: 'customers', label: 'Customers', href: '#customers', pages: [page('clients', 'Clients', '#clients')] },
  { id: 'team', label: 'Team', href: '#team', pages: [page('employees', 'Employees', '/staff/create')] },
  { id: 'reports', label: 'Reports', href: '#reports', pages: [page('summary', 'Summary', '#summary')] },
  {
    id: 'setup',
    label: 'Setup',
    href: '#setup',
    pages: [page('columns', 'Columns', '/staff-app-columns')],
  },
];

export const modules: readonly NavigationModule[] = [
  {
    id: 'today',
    label: 'Today',
    href: '#today',
    sections: [
      { id: 'today-main', label: 'Main', pages: [page('approvals', 'Approvals', '#approvals')] },
    ],
  },
  {
    id: 'sell',
    label: 'Sell',
    href: '#sell',
    sections: [
      { id: 'sell-orders', label: 'Orders', pages: [page('orders', 'Sales orders', '#orders')] },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    href: '#stock',
    sections: [
      { id: 'stock-items', label: 'Items', pages: [page('products', 'Products', '#products')] },
    ],
  },
  {
    id: 'grow',
    label: 'Grow',
    href: '#grow',
    sections: [
      { id: 'grow-offers', label: 'Offers', pages: [page('offers', 'Offers', '#offers', 'Soon')] },
    ],
  },
  {
    id: 'people',
    label: 'People',
    href: '#people',
    sections: [
      { id: 'people-team', label: 'Team', pages: [page('employees', 'Employees', '/staff/create')] },
    ],
  },
  {
    id: 'business',
    label: 'Business',
    href: '#business',
    sections: [
      {
        id: 'business-setup',
        label: 'Business',
        pages: [page('columns', 'Columns', '/staff-app-columns')],
      },
    ],
  },
];

export const workspaces: readonly NavigationWorkspace[] = [
  {
    id: 'front-desk',
    label: 'Front desk',
    sections: [
      { id: 'desk-orders', label: 'Orders', pages: [page('orders', 'Sales orders', '#orders')] },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    sections: [
      { id: 'stock-items', label: 'Items', pages: [page('products', 'Products', '#products')] },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    sections: [
      { id: 'customer-clients', label: 'Clients', pages: [page('clients', 'Clients', '#clients')] },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    sections: [
      { id: 'team-people', label: 'People', pages: [page('employees', 'الموظفون', '/staff/create')] },
    ],
  },
  {
    id: 'business',
    label: 'Business',
    sections: [
      {
        id: 'business-setup',
        label: 'Setup',
        pages: [
          page('columns', 'الأعمدة', '/staff-app-columns'),
          page('offers', 'العروض', '#offers', 'Soon'),
        ],
      },
    ],
  },
];
