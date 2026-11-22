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
