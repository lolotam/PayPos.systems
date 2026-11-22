import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { LocalNav } from '../local-nav.js';
import { TopNav } from '../top-nav.js';
import { chromeLabels, modules } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

function stubDesktop() {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const sell = modules.find((item) => item.id === 'sell');
if (sell === undefined) throw new Error('fixture module sell is missing');

it('draws the local list under the bar by default', () => {
  stubDesktop();
  render(
    <DirectionProvider dir="ltr">
      <TopNav modules={modules} labels={chromeLabels} currentModuleId="sell" />
    </DirectionProvider>,
  );
  expect(screen.getByRole('navigation', { name: chromeLabels.localNavigation })).toBeTruthy();
});

it('leaves the local list to the host when it opts out', () => {
  stubDesktop();
  render(
    <DirectionProvider dir="ltr">
      <TopNav modules={modules} labels={chromeLabels} currentModuleId="sell" localNav="none" />
    </DirectionProvider>,
  );
  expect(screen.queryByRole('navigation', { name: chromeLabels.localNavigation })).toBeNull();
  expect(screen.getByRole('navigation', { name: chromeLabels.navigation })).toBeTruthy();
});

it('scrolls the current page into view when the active page changes', () => {
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  const twoPages = {
    ...sell,
    sections: [
      {
        id: 's',
        label: 'S',
        pages: [
          { id: 'one', label: 'One', href: '#one' },
          { id: 'two', label: 'Two', href: '#two' },
        ],
      },
    ],
  };
  const { rerender } = render(
    <LocalNav module={twoPages} labels={chromeLabels} activePageId="one" />,
  );
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll.mock.contexts[0]).toBe(screen.getByRole('link', { name: 'One' }));
  rerender(<LocalNav module={twoPages} labels={chromeLabels} activePageId="two" />);
  expect(scroll).toHaveBeenCalledTimes(2);
  expect(scroll.mock.contexts[1]).toBe(screen.getByRole('link', { name: 'Two' }));
  expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

it('does not fail where scrolling into view is not available', () => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  render(<LocalNav module={sell} labels={chromeLabels} activePageId="orders" />);
  expect(screen.getByRole('link', { name: /Sales orders/ })).toBeTruthy();
});

const twoSections = {
  ...sell,
  sections: [
    { id: 'first', label: 'First group', pages: [{ id: 'one', label: 'One', href: '#one' }] },
    { id: 'second', label: 'Second group', pages: [{ id: 'two', label: 'Two', href: '#two' }] },
  ],
};

it('groups the vertical list under its section headings, the horizontal strip hiding them', () => {
  render(<LocalNav module={twoSections} labels={chromeLabels} activePageId="one" />);
  const list = screen.getByRole('list');
  const names = [...list.children].map((item) => item.textContent);
  expect(names).toEqual(['First group', 'One', 'Second group', 'Two']);
  const heading = screen.getByRole('heading', { name: 'First group' });
  expect(heading.closest('li')?.className).toContain('hidden');
  expect(heading.closest('li')?.className).toContain('min-[1024px]:block');
});

it('leaves out the heading of a section with no visible page', () => {
  render(
    <LocalNav
      module={twoSections}
      labels={chromeLabels}
      activePageId="one"
      visiblePageIds={['one']}
    />,
  );
  expect(screen.queryByRole('heading', { name: 'Second group' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'First group' })).toBeTruthy();
});

it('scrolls to the current page when permissions reveal it after the first draw', () => {
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  const { rerender } = render(
    <LocalNav
      module={twoSections}
      labels={chromeLabels}
      activePageId="two"
      visiblePageIds={['one']}
    />,
  );
  expect(scroll).not.toHaveBeenCalled();
  rerender(
    <LocalNav
      module={twoSections}
      labels={chromeLabels}
      activePageId="two"
      visiblePageIds={['one', 'two']}
    />,
  );
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll.mock.contexts[0]).toBe(screen.getByRole('link', { name: 'Two' }));
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});
