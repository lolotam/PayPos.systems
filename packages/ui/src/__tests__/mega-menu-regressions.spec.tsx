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

function renderOpenMenu(module: NavigationModule, visiblePageIds: readonly string[]) {
  return render(
    <DirectionProvider dir="ltr">
      <MegaMenu
        modules={[visibleModule, excludedModule]}
        module={module}
        labels={chromeLabels}
        open
        currentModuleId={module.id}
        visiblePageIds={visiblePageIds}
        onOpenChange={() => {}}
        onSwitchModule={() => {}}
      />
    </DirectionProvider>,
  );
}

it('omits excluded modules and their overview from a standalone mega menu', () => {
  renderOpenMenu(excludedModule, ['orders']);
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
  render(
    <DirectionProvider dir="ltr">
      <MegaMenu
        modules={[shortModule]}
        module={shortModule}
        labels={chromeLabels}
        open
        onOpenChange={() => {}}
        onSwitchModule={() => {}}
      />
    </DirectionProvider>,
  );
  expect(screen.getByRole('button', { name: /AI/ }).className).toContain('min-w-11');
  const dialog = screen.getByRole('dialog', { name: 'AI' });
  expect(within(dialog).getByRole('button', { name: /AI/ }).className).toContain('min-w-11');
});
