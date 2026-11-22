import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { PageFinder, type PageFinderProps } from '../page-finder.js';
import { finderLabels, workspaces } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

function tree(dir: 'rtl' | 'ltr', props: Partial<PageFinderProps> = {}) {
  return (
    <DirectionProvider dir={dir}>
      <button type="button">outside target</button>
      <PageFinder workspaces={workspaces} labels={finderLabels} {...props} />
    </DirectionProvider>
  );
}

function openWithShortcut(key: 'k' | 'K', modifier: 'ctrlKey' | 'metaKey') {
  fireEvent.keyDown(window, { key, [modifier]: true });
  return screen.getByRole('dialog', { name: finderLabels.title });
}

it.each([
  ['k', 'ctrlKey'],
  ['K', 'metaKey'],
] as const)('opens on %s with %s and focuses search', (key, modifier) => {
  render(tree('ltr'));
  const dialog = openWithShortcut(key, modifier);
  const input = within(dialog).getByRole('searchbox', { name: finderLabels.search });
  expect(document.activeElement).toBe(input);
  expect(dialog.className).toContain('overflow-y-auto');
});

it.each(['rtl', 'ltr'] as const)('filters by translated label and selects the first match with Enter in %s', async (dir) => {
  const onNavigate = vi.fn();
  render(tree(dir, { activePageId: 'columns', onNavigate }));
  const dialog = openWithShortcut('k', 'ctrlKey');
  expect(dialog.getAttribute('dir')).toBe(dir);
  const input = within(dialog).getByRole('searchbox', { name: finderLabels.search });
  fireEvent.change(input, { target: { value: 'الأعمدة' } });
  const result = within(dialog).getByRole('link', { name: /الأعمدة/ });
  expect(result.getAttribute('href')).toBe('/staff-app-columns');
  expect(result.textContent).toContain(finderLabels.current);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

it('activates the first visible query result through its link and restores shortcut focus', async () => {
  const onNavigate = vi.fn();
  render(tree('ltr', { onNavigate }));
  const outside = screen.getByRole('button', { name: 'outside target' });
  outside.focus();
  const dialog = openWithShortcut('k', 'ctrlKey');
  const input = within(dialog).getByRole('searchbox', { name: finderLabels.search });
  const links = within(dialog).getAllByRole('link');
  const activated: string[] = [];
  for (const link of links) {
    link.addEventListener(
      'click',
      (event) => {
        activated.push(link.textContent ?? '');
        event.preventDefault();
      },
      { capture: true },
    );
  }
  links[0]?.setAttribute('hidden', '');
  const expected = links[1]?.textContent ?? '';
  expect(expected).not.toBe('');

  fireEvent.keyDown(input, { key: 'Enter' });

  expect(activated).toEqual([expected]);
  expect(onNavigate).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(outside));
});

it('filters hidden destinations and shows the empty state', () => {
  render(tree('ltr', { visiblePageIds: ['products'] }));
  const dialog = openWithShortcut('k', 'ctrlKey');
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);
  expect(within(dialog).getByRole('link', { name: /Products/ })).toBeTruthy();
  const input = within(dialog).getByRole('searchbox', { name: finderLabels.search });
  fireEvent.change(input, { target: { value: 'no-such-page' } });
  expect(within(dialog).getByText(finderLabels.empty)).toBeTruthy();
  expect(within(dialog).queryAllByRole('link')).toHaveLength(0);
});

it('returns focus after a shortcut close but not after a trigger close', async () => {
  render(tree('ltr'));
  const outside = screen.getByRole('button', { name: 'outside target' });
  outside.focus();
  let dialog = openWithShortcut('k', 'ctrlKey');
  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(outside));

  const trigger = screen.getByRole('button', { name: finderLabels.trigger });
  fireEvent.click(trigger);
  dialog = screen.getByRole('dialog', { name: finderLabels.title });
  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('ignores unrelated keys and toggles closed on a second shortcut', async () => {
  render(tree('ltr'));
  fireEvent.keyDown(window, { key: 'k' });
  fireEvent.keyDown(window, { key: 'x', ctrlKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
  openWithShortcut('k', 'ctrlKey');
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
