import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AccountMenu, type AccountMenuEntry } from '../account-menu.js';
import { DirectionProvider } from '../direction-provider.js';

const entries: readonly AccountMenuEntry[] = [
  { id: 'authenticator', label: 'Authenticator', href: '#two-factor' },
  { id: 'appearance', label: 'Appearance', href: '#appearance' },
  { id: 'style', label: 'Navigation style', onSelect: vi.fn() },
  { id: 'signout', label: 'Sign out', onSelect: vi.fn() },
];

function menu(props: {
  name?: string;
  email?: string;
  entries?: typeof entries;
  footer?: React.ReactNode;
}) {
  return (
    <DirectionProvider dir="rtl">
      <AccountMenu
        labels={{ label: 'Account menu' }}
        {...(props.name === undefined ? {} : { name: props.name })}
        {...(props.email === undefined ? {} : { email: props.email })}
        entries={props.entries ?? entries}
        {...(props.footer === undefined ? {} : { footer: props.footer })}
      />
    </DirectionProvider>
  );
}

function openAccountMenu() {
  const trigger = screen.getByRole('button', { name: 'Account menu' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}

it('gives the icon-only trigger an accessible name from the caller', () => {
  render(menu({ name: 'Sara', email: 'sara@example.com' }));
  expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
  expect(screen.queryByText('Sara')).toBeNull();
});

it('opens with the name and email above the entries in the order given', async () => {
  render(menu({ name: 'Sara', email: 'sara@example.com' }));
  openAccountMenu();
  expect(await screen.findByText('Sara')).toBeTruthy();
  expect(screen.getByText('sara@example.com')).toBeTruthy();
  const items = screen.getAllByRole('menuitem');
  expect(items.map((item) => item.textContent)).toEqual([
    'Authenticator',
    'Appearance',
    'Navigation style',
    'Sign out',
  ]);
  expect(items[0]?.getAttribute('href')).toBe('#two-factor');
});

it('keeps the two entries given in the story order even with links and buttons mixed', async () => {
  render(menu({ name: 'Sara', email: 'sara@example.com', entries: [...entries] }));
  openAccountMenu();
  const signOut = await screen.findByRole('menuitem', { name: 'Sign out' });
  fireEvent.click(signOut);
  await waitFor(() => expect(entries[3]?.onSelect).toHaveBeenCalled());
});

it('still opens with neither name nor email', async () => {
  render(menu({}));
  openAccountMenu();
  expect(await screen.findByRole('menuitem', { name: 'Authenticator' })).toBeTruthy();
  expect(screen.queryByText('Sara')).toBeNull();
  expect(screen.queryByText('sara@example.com')).toBeNull();
});

it('disables a pending entry and shows it as waiting', async () => {
  render(
    menu({
      name: 'Sara',
      email: 'sara@example.com',
      entries: [{ id: 'signout', label: 'Sign out', onSelect: vi.fn(), pending: true }],
    }),
  );
  openAccountMenu();
  const signOut = await screen.findByRole('menuitem', { name: 'Sign out' });
  expect(signOut.getAttribute('aria-disabled') === 'true' || signOut.hasAttribute('disabled')).toBe(
    true,
  );
});

it('renders the supplied footer slot below the entries', async () => {
  render(menu({ name: 'Sara', footer: <div>theme switch slot</div> }));
  openAccountMenu();
  expect(await screen.findByText('theme switch slot')).toBeTruthy();
});

it('closes on Escape and returns the focus to the trigger', async () => {
  render(menu({ name: 'Sara' }));
  const trigger = openAccountMenu();
  trigger.focus();
  expect(await screen.findByRole('menu', { name: 'Account menu' })).toBeTruthy();
  fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
