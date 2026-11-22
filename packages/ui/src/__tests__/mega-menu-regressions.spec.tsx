import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { MegaMenu } from '../mega-menu.js';
import type { NavigationModule } from '../navigation-presentation.js';
import { chromeLabels } from './navigation-fixtures.js';

const visibleModule: NavigationModule = {
  id: 'sell',
  label: 'Sell',
  href: '#sell',
  sections: [{ id: 'orders', label: 'Orders', pages: [{ id: 'orders', label: 'Orders', href: '#orders' }] }],
};

const excludedModule: NavigationModule = {
  id: 'business',
  label: 'Business',
  href: '#business',
  sections: [{ id: 'setup', label: 'Setup', pages: [{ id: 'columns', label: 'Columns', href: '#columns' }] }],
};

function menuTree(
  modules: readonly NavigationModule[],
  module: NavigationModule,
  open: boolean,
  visiblePageIds?: readonly string[],
) {
  return (
    <DirectionProvider dir="ltr">
      <MegaMenu
        modules={modules}
        module={module}
        labels={chromeLabels}
        open={open}
        currentModuleId={module.id}
        visiblePageIds={visiblePageIds}
        onOpenChange={() => {}}
        onSwitchModule={() => {}}
      />
    </DirectionProvider>
  );
}

it('omits excluded modules and their overview from a standalone mega menu', () => {
  render(menuTree([visibleModule, excludedModule], excludedModule, true, ['orders']));
  const dialog = screen.getByRole('dialog', { name: 'Business' });
  expect(within(dialog).queryByRole('button', { name: /Business/ })).toBeNull();
  expect(within(dialog).queryByRole('link', { name: 'Overview' })).toBeNull();
  expect(within(dialog).getByRole('button', { name: /Sell/ })).toBeTruthy();
});

it('keeps a long module label inside its trigger instead of overflowing a neighbour', () => {
  const longModule: NavigationModule = {
    ...visibleModule,
    id: 'long',
    label: 'إدارة المخزون والتقارير التفصيلية'.repeat(10),
  };
  render(menuTree([longModule, excludedModule], longModule, false));
  // jsdom has no layout engine; the CI browser fixture measures the real overflow.
  const trigger = screen.getByRole('button', { name: new RegExp('إدارة المخزون') });
  expect(trigger.className).toContain('shrink-0');
  expect(trigger.className).toContain('max-w-64');
  const label = trigger.querySelector('span');
  expect(label?.className).toContain('min-w-0');
  expect(label?.className).toContain('truncate');
});

it('keeps short module and switcher labels at 44px touch targets', () => {
  const shortModule: NavigationModule = {
    id: 'ai',
    label: 'AI',
    href: '#ai',
    sections: [{ id: 'ai-main', label: 'AI', pages: [{ id: 'ai-page', label: 'AI', href: '#ai' }] }],
  };
  const view = render(menuTree([shortModule], shortModule, false));
  expect(screen.getByRole('button', { name: /AI/ }).className).toContain('min-w-11');

  view.rerender(menuTree([shortModule], shortModule, true));
  const dialog = screen.getByRole('dialog', { name: 'AI' });
  expect(within(dialog).getByRole('button', { name: /AI/ }).className).toContain('min-w-11');
});

it('caps the menu by the window height instead of a fixed pixel size', () => {
  render(menuTree([visibleModule], visibleModule, true));
  const dialog = screen.getByRole('dialog', { name: 'Sell' });
  // jsdom has no layout engine; the class is what lets a tall window show the whole menu.
  expect(dialog.className).toContain('max-h-[calc(100dvh-4.5rem)]');
  expect(dialog.className).toContain('min-[1024px]:max-h-[calc(100dvh-5rem)]');
  expect(dialog.className).toContain('overflow-y-auto');
  expect(dialog.className).not.toContain('32rem');
  expect(dialog.className).not.toContain('70vh');
});
