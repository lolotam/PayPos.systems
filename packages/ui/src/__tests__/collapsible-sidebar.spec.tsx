import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CollapsibleSidebar, type CollapsibleSidebarProps } from '../collapsible-sidebar.js';
import { DirectionProvider } from '../direction-provider.js';
import { chromeLabels, groups } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

type MediaState = { phone?: boolean; tablet?: boolean };

function stubMedia(state: MediaState | (() => MediaState) = {}) {
  const read = () => (typeof state === 'function' ? state() : state);
  vi.stubGlobal('matchMedia', (query: string) => {
    const { phone = false, tablet = false } = read();
    return {
      matches: query.includes('max-width: 599px')
        ? phone
        : query.includes('max-width: 1023px')
          ? tablet
          : false,
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
  stubMedia({ tablet: true });
  const tablet = render(tree('ltr', { currentGroupId: 'home' }));
  expect(tablet.container.querySelector('aside')?.getAttribute('data-collapsed')).toBe('');
  expect(tablet.container.querySelector('aside')?.className).toContain('w-20');
  expect(screen.getByRole('button', { name: chromeLabels.collapse }).className).toContain(
    'min-[1024px]:inline-flex',
  );
  tablet.unmount();

  stubMedia({ phone: true });
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
  let tablet = false;
  stubMedia(() => ({ tablet }));
  const view = render(tree('ltr', { currentGroupId: 'home' }));
  const toggle = screen.getByRole('button', { name: chromeLabels.collapse });
  toggle.focus();
  tablet = true;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: /Home/ })));

  const firstLinkAfterRail = screen.getByRole('link', { name: /Home/ });
  firstLinkAfterRail.focus();
  tablet = false;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(firstLinkAfterRail));
});

it('transfers focus from a hidden header slot to a rail link at 1024 to 1023', async () => {
  let tablet = false;
  stubMedia(() => ({ tablet }));
  const view = render(
    tree('ltr', {
      currentGroupId: 'home',
      header: <button type="button">Header action</button>,
    }),
  );
  const headerAction = screen.getByRole('button', { name: 'Header action' });
  headerAction.focus();
  expect(document.activeElement).toBe(headerAction);

  tablet = true;
  view.rerender(
    tree('ltr', {
      currentGroupId: 'home',
      header: <button type="button">Header action</button>,
    }),
  );
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: /Home/ })));
});

it('keeps focus outside the sidebar when the tablet breakpoint changes', async () => {
  let tablet = false;
  stubMedia(() => ({ tablet }));
  const view = render(tree('ltr', { currentGroupId: 'home' }));
  const outside = screen.getByRole('textbox', { name: 'Outside field' });
  outside.focus();

  tablet = true;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(outside));

  tablet = false;
  view.rerender(tree('ltr', { currentGroupId: 'home' }));
  await waitFor(() => expect(document.activeElement).toBe(outside));
});
