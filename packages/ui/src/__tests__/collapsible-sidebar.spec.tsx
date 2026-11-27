import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CollapsibleSidebar, type CollapsibleSidebarProps } from '../collapsible-sidebar.js';
import { DirectionProvider } from '../direction-provider.js';
import type { NavigationGroup } from '../navigation-presentation.js';
import { chromeLabels, groups } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

type MediaState = { width?: number };

function stubMedia(state: MediaState | (() => MediaState) = {}) {
  const read = () => (typeof state === 'function' ? state() : state);
  vi.stubGlobal('matchMedia', (query: string) => {
    const { width = 1200 } = read();
    const matches =
      query === '(width < 600px)'
        ? width < 600
        : query === '(600px <= width < 1024px)'
          ? width >= 600 && width < 1024
          : false;
    return {
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });
}

function tree(dir: 'rtl' | 'ltr', props: Partial<CollapsibleSidebarProps> = {}) {
  return (
    <DirectionProvider dir={dir}>
      <input aria-label="Outside field" />
      <CollapsibleSidebar
        title="Navigation"
        collapseLabel={chromeLabels.collapse}
        expandLabel={chromeLabels.expand}
        groups={groups}
        {...props}
      />
      <p>page content</p>
    </DirectionProvider>
  );
}

it('collapses and expands while keeping the current group, focus and page content', () => {
  stubMedia();
  const view = render(tree('ltr', { currentGroupId: 'home' }));
  const aside = view.container.querySelector('aside');
  expect(aside?.className).toContain('w-66');
  const toggle = screen.getByRole('button', { name: chromeLabels.collapse });
  toggle.focus();
  fireEvent.click(toggle);
  expect(aside?.getAttribute('data-collapsed')).toBe('');
  expect(aside?.className).toContain('w-20');
  expect(document.activeElement).toBe(toggle);
  expect(screen.getByRole('link', { name: /Home/ }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByText('page content')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: chromeLabels.expand }));
  expect(aside?.getAttribute('data-collapsed')).toBeNull();
  expect(aside?.className).toContain('w-66');
});

it('uses a tablet rail and leaves the phone shell to a later integration', () => {
  stubMedia({ width: 800 });
  const tablet = render(tree('ltr', { currentGroupId: 'home' }));
  expect(tablet.container.querySelector('aside')?.getAttribute('data-collapsed')).toBe('');
  expect(tablet.container.querySelector('aside')?.className).toContain('w-20');
  expect(screen.getByRole('button', { name: chromeLabels.collapse }).className).toContain(
    'min-[1024px]:inline-flex',
  );
  tablet.unmount();

  stubMedia({ width: 500 });
  const phone = render(tree('ltr'));
  expect(phone.container.querySelector('aside')).toBeNull();
  expect(screen.getByText('page content')).toBeTruthy();
});

it.each(['rtl', 'ltr'] as const)('filters empty groups and keeps child highlighting in %s', (dir) => {
  stubMedia();
  const view = render(
    tree(dir, { visiblePageIds: ['employees'], currentPageId: 'employees' }),
  );
  const aside = view.container.querySelector('aside');
  expect(aside?.getAttribute('dir')).toBe(dir);
  expect(aside?.className).toContain('start-0');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  const team = screen.getByRole('link', { name: /Team/ });
  expect(team.getAttribute('dir')).toBe(dir);
  expect(team.getAttribute('aria-current')).toBe('page');
  expect(team.classList.contains('bg-sidebar-primary')).toBe(true);
  expect(team.textContent).not.toContain('2');
  expect(screen.queryByRole('link', { name: /Home/ })).toBeNull();
});

it('hides a group whose only page is excluded', () => {
  stubMedia();
  render(tree('ltr', { visiblePageIds: ['missing'] }));
  expect(screen.queryAllByRole('link')).toHaveLength(0);
});

it('removes hidden header and footer slot controls from the tab order when railed', () => {
  stubMedia();
  const header = <button type="button">Header action</button>;
  const footer = <button type="button">Footer action</button>;
  render(tree('ltr', { header, footer }));
  expect(screen.getByRole('button', { name: 'Header action' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Footer action' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: chromeLabels.collapse }));
  expect(screen.queryByRole('button', { name: 'Header action' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Footer action' })).toBeNull();
});

it('transfers focus from the desktop toggle to a visible rail link at 1024 to 1023', async () => {
  let width = 1200;
  stubMedia(() => ({ width }));
  const view = render(tree('ltr', { currentGroupId: 'home' }));
  const toggle = screen.getByRole('button', { name: chromeLabels.collapse });
  toggle.focus();
  width = 800;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: /Home/ })));

  const firstLinkAfterRail = screen.getByRole('link', { name: /Home/ });
  firstLinkAfterRail.focus();
  width = 1200;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(firstLinkAfterRail));
});

it('transfers focus from a hidden header slot to a rail link at 1024 to 1023', async () => {
  let width = 1200;
  stubMedia(() => ({ width }));
  const view = render(
    tree('ltr', {
      currentGroupId: 'home',
      header: <button type="button">Header action</button>,
    }),
  );
  const headerAction = screen.getByRole('button', { name: 'Header action' });
  headerAction.focus();
  expect(document.activeElement).toBe(headerAction);

  width = 800;
  view.rerender(
    tree('ltr', {
      currentGroupId: 'home',
      header: <button type="button">Header action</button>,
    }),
  );
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: /Home/ })));
});

it('keeps focus outside the sidebar when the tablet breakpoint changes', async () => {
  let width = 1200;
  stubMedia(() => ({ width }));
  const view = render(tree('ltr', { currentGroupId: 'home' }));
  const outside = screen.getByRole('textbox', { name: 'Outside field' });
  outside.focus();

  width = 800;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(outside));

  width = 1200;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(outside));
});

it('transfers focus at the fractional 1024 to 1023.5 sidebar boundary', async () => {
  let width = 1024;
  stubMedia(() => ({ width }));
  const view = render(tree('ltr', { currentGroupId: 'home' }));
  screen.getByRole('button', { name: chromeLabels.collapse }).focus();

  width = 1023.5;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: /Home/ })));
  expect(view.container.querySelector('aside')?.getAttribute('data-collapsed')).toBe('');
});

it('shows group labels in the rail when no icons are supplied', () => {
  stubMedia({ width: 800 });
  render(tree('ltr'));
  const link = screen.getByRole('link', { name: /Home/ });
  expect(link.getAttribute('aria-label')).toBe('Home');
  expect(
    screen.getAllByText('Home').some((node) => !node.className.includes('sr-only')),
  ).toBe(true);
});

it('marks only the explicitly current group when the active page is in another group', () => {
  stubMedia();
  render(tree('ltr', { currentGroupId: 'sales', currentPageId: 'approvals' }));
  const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
  expect(current).toHaveLength(1);
  expect(current).toEqual([screen.getByRole('link', { name: /Sales/ })]);
});

it('falls back to the page group when the explicit current group is hidden', () => {
  stubMedia();
  render(
    tree('ltr', {
      visiblePageIds: ['approvals'],
      currentGroupId: 'sales',
      currentPageId: 'approvals',
    }),
  );
  const homeLink = screen.getByRole('link', { name: /Home/ });
  expect(screen.getAllByRole('link')).toEqual([homeLink]);
  expect(homeLink.getAttribute('aria-current')).toBe('page');
});

it('leaves the sidebar shell at the fractional 600 to 599.5 phone boundary', () => {
  let width = 600;
  stubMedia(() => ({ width }));
  const view = render(tree('ltr'));
  expect(view.container.querySelector('aside')).toBeTruthy();

  width = 599.5;
  view.rerender(tree('ltr'));
  expect(view.container.querySelector('aside')).toBeNull();
});

it('leaves focus alone at the tablet breakpoint after a press outside the sidebar', async () => {
  let width = 1200;
  stubMedia(() => ({ width }));
  const view = render(tree('ltr', { currentGroupId: 'home' }));
  const toggle = screen.getByRole('button', { name: chromeLabels.collapse });
  toggle.focus();
  // A press on non-focusable content drops focus to body; the release may even land in the sidebar.
  toggle.blur();
  fireEvent.pointerUp(screen.getByRole('link', { name: /Home/ }));

  width = 800;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(screen.getByRole('link', { name: /Home/ })).toBeTruthy());
  expect(document.activeElement).toBe(document.body);
});

it('still transfers focus at the tablet breakpoint when an outside press left focus on the toggle', async () => {
  let width = 1200;
  stubMedia(() => ({ width }));
  const view = render(tree('ltr', { currentGroupId: 'home' }));
  const toggle = screen.getByRole('button', { name: chromeLabels.collapse });
  toggle.focus();
  // The outside control cancelled the focus move, so the toggle is still focused at pointerup.
  fireEvent.pointerUp(screen.getByText('page content'));
  toggle.blur();

  width = 800;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: /Home/ })));
});

function homeWithIcon(): readonly NavigationGroup[] {
  return groups.map((group) => (group.id === 'home' ? { ...group, icon: <svg /> } : group));
}

it('gives icon-only rail links a native title and omits it when the label is visible', () => {
  stubMedia({ width: 800 });
  render(tree('ltr', { groups: homeWithIcon() }));
  expect(screen.getByRole('link', { name: 'Home' }).getAttribute('title')).toBe('Home');
  // no icon: the label itself is the visible content of the rail link
  expect(screen.getByRole('link', { name: 'Sales' }).hasAttribute('title')).toBe(false);
});

it('omits the title when the sidebar is expanded and shows the label as text', () => {
  stubMedia();
  render(tree('ltr', { groups: homeWithIcon() }));
  expect(screen.getByRole('link', { name: /Home/ }).hasAttribute('title')).toBe(false);
});

it('centres the collapse toggle in the rail and keeps it at the inline end when expanded', () => {
  stubMedia();
  render(tree('ltr', { currentGroupId: 'home' }));
  const expandedToggle = screen.getByRole('button', { name: chromeLabels.collapse });
  const expandedRow = expandedToggle.parentElement;
  expect(expandedRow?.className).toContain('justify-center');
  expect(expandedRow?.className).toContain('relative');
  expect(expandedToggle.className).toContain('end-2');
  expect(expandedToggle.className).toContain('min-[1024px]:absolute');
  fireEvent.click(expandedToggle);
  const railToggle = screen.getByRole('button', { name: chromeLabels.expand });
  const railRow = railToggle.parentElement;
  expect(railRow?.className).toContain('justify-center');
  expect(railToggle.className).not.toContain('end-2');
  expect(railToggle.className).not.toContain('min-[1024px]:absolute');
});

it('shares one header row between the header slot and the collapse toggle', () => {
  stubMedia();
  render(tree('ltr', { header: <span>Header mark</span> }));
  const toggle = screen.getByRole('button', { name: chromeLabels.collapse });
  const row = toggle.parentElement as HTMLElement;
  expect(within(row).getByText('Header mark')).toBeTruthy();
  expect(row.className).toContain('justify-center');
  expect(row.className).toContain('relative');
  // وفي الشريط المطويّ يختفي رأس الشريط من غير تكرار، ويبقى مبدّل التوسيع في الوسط
  fireEvent.click(toggle);
  const railRow = screen.getByRole('button', { name: chromeLabels.expand }).parentElement as HTMLElement;
  expect(within(railRow).queryByText('Header mark')).toBeNull();
  expect(railRow.className).toContain('justify-center');
});

it('falls back to the visible label when a rail icon is conditionally false', () => {
  stubMedia({ width: 800 });
  const conditional = groups.map((group) => {
    if (group.id === 'home') return { ...group, icon: false };
    if (group.id === 'sales') return { ...group, icon: [false, null] };
    return group.id === 'team' ? { ...group, icon: '' } : group;
  });
  render(tree('ltr', { groups: conditional }));
  for (const name of ['Home', 'Sales', 'Team']) {
    const link = screen.getByRole('link', { name });
    expect(link.hasAttribute('title')).toBe(false);
    expect(within(link).getAllByText(name).some((node) => !node.className.includes('sr-only'))).toBe(true);
  }
});

it('centres rail links on the same line as the collapse toggle', () => {
  stubMedia({ width: 800 });
  render(tree('ltr', { groups: homeWithIcon() }));
  const home = screen.getByRole('link', { name: 'Home' });
  expect(home.className).toContain('mx-auto');
  expect(home.className).toContain('max-w-full');
  expect(home.className).toContain('min-w-11');
  expect(home.className).toContain('gap-0');
  expect(home.className).not.toContain('gap-2');
});

it('leaves focus alone at the tablet breakpoint when a touch tap moved focus after pointerup', async () => {
  let width = 1200;
  stubMedia(() => ({ width }));
  const view = render(tree('ltr', { currentGroupId: 'home' }));
  const toggle = screen.getByRole('button', { name: chromeLabels.collapse });
  toggle.focus();
  const content = screen.getByText('page content');
  // Touch browsers apply the tap's focus change after pointerup, so the toggle is still focused here.
  fireEvent.pointerUp(content);
  expect(document.activeElement).toBe(toggle);
  toggle.blur();
  fireEvent.click(content);

  width = 800;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(screen.getByRole('link', { name: /Home/ })).toBeTruthy());
  expect(document.activeElement).toBe(document.body);
});
