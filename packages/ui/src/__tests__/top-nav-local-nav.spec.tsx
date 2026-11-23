import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { LocalNav } from '../local-nav.js';
import { TopNav } from '../top-nav.js';
import { chromeLabels, modules } from './navigation-fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

const box = (top: number, bottom: number, left = 0, right = 100) =>
  ({ top, bottom, left, right }) as DOMRect;

/** يعطي القائمة وكل رابط مقاسًا ثابتًا بالنص، لأن jsdom لا يحسب تخطيطًا، ويراقب scrollIntoView. */
function stubLayout(nav: DOMRect, items: Record<string, DOMRect>) {
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.tagName === 'NAV' ? nav : (items[this.textContent ?? ''] ?? box(0, 0));
  });
  return scrollIntoView;
}

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

it('scrolls only its own list to the current page, never the page around it', () => {
  const scrollIntoView = stubLayout(box(100, 300, 0, 100), {
    One: box(40, 80, -60, 40),
    Two: box(350, 390, 120, 220),
  });
  const { rerender } = render(
    <LocalNav module={twoPages} labels={chromeLabels} activePageId="two" />,
  );
  const nav = screen.getByRole('navigation', { name: chromeLabels.localNavigation });
  expect([nav.scrollTop, nav.scrollLeft]).toEqual([90, 120]);
  rerender(<LocalNav module={twoPages} labels={chromeLabels} activePageId="one" />);
  expect([nav.scrollTop, nav.scrollLeft]).toEqual([30, 60]);
  expect(scrollIntoView).not.toHaveBeenCalled();
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
  stubLayout(box(100, 300), { Two: box(350, 390) });
  const { rerender } = render(
    <LocalNav
      module={twoSections}
      labels={chromeLabels}
      activePageId="two"
      visiblePageIds={['one']}
    />,
  );
  const nav = screen.getByRole('navigation', { name: chromeLabels.localNavigation });
  expect(nav.scrollTop).toBe(0);
  rerender(
    <LocalNav
      module={twoSections}
      labels={chromeLabels}
      activePageId="two"
      visiblePageIds={['one', 'two']}
    />,
  );
  expect(nav.scrollTop).toBe(90);
});
