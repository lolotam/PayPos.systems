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

function menu(props: { name?: string; email?: string; entries?: typeof entries }) {
  return (
    <DirectionProvider dir="rtl">
      <AccountMenu
        labels={{ label: 'Account menu' }}
        {...(props.name === undefined ? {} : { name: props.name })}
        {...(props.email === undefined ? {} : { email: props.email })}
        entries={props.entries ?? entries}
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
  // اختيار الإجراء يقفل القائمة قدام المستخدم، وبجانبه إبلاغ المستدعي
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Account menu' })).toBeNull());
  expect(entries[3]?.onSelect).toHaveBeenCalled();
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

it('drops the native activation of a focused link entry while it is disabled', async () => {
  // رابط يتعطّل وهو مفتوح: من غير href لا توجد وجهة يتبعها Enter أو الضغط
  const view = render(menu({ entries: [{ id: 'signout', label: 'Sign out', href: '/sign-out' }] }));
  openAccountMenu();
  const signOut = await screen.findByRole('menuitem', { name: 'Sign out' });
  expect(signOut.getAttribute('href')).toBe('/sign-out');
  view.rerender(
    <DirectionProvider dir="rtl">
      <AccountMenu
        labels={{ label: 'Account menu' }}
        entries={[{ id: 'signout', label: 'Sign out', href: '/sign-out', pending: true }]}
      />
    </DirectionProvider>,
  );
  const pendingRow = screen.getByRole('menuitem', { name: 'Sign out' });
  expect(pendingRow.getAttribute('href')).toBeNull();
  expect(pendingRow.getAttribute('aria-disabled')).toBe('true');
  // وعند رجوع الحالة الرابط يستعيد وجهته من جديد
  view.rerender(
    <DirectionProvider dir="rtl">
      <AccountMenu
        labels={{ label: 'Account menu' }}
        entries={[{ id: 'signout', label: 'Sign out', href: '/sign-out' }]}
      />
    </DirectionProvider>,
  );
  expect(screen.getByRole('menuitem', { name: 'Sign out' }).getAttribute('href')).toBe('/sign-out');
});

it('bounds the menu to the available viewport with internal scrolling and a capped width', async () => {
  render(menu({ name: 'Sara', email: 'sara@example.com' }));
  openAccountMenu();
  const content = await screen.findByRole('menu', { name: 'Account menu' });
  // الارتفاع محدود بالمساحة المتاحة من Radix مع تمرير داخلي، فلا يخرج Sign out عن الشاشة
  expect(content.className).toContain(
    'max-h-[var(--radix-dropdown-menu-content-available-height)]',
  );
  expect(content.className).toContain('overflow-y-auto');
  // والعرض مُسقوف بالمساحة المتاحة كي لا يوسّع بريد طويل بلا فواصل القائمة عن الشاشة
  expect(content.className).toContain('max-w-[var(--radix-dropdown-menu-content-available-width)]');
  // نص الهوية يُقصّ داخل العرض المسقوف بدل أن يفرض عرضًا أكبر
  expect(screen.getByText('sara@example.com').className).toContain('truncate');
});

it('closes on Escape and returns the focus to the trigger', async () => {
  render(menu({ name: 'Sara' }));
  const trigger = openAccountMenu();
  const menuElement = await screen.findByRole('menu', { name: 'Account menu' });
  // مفتوحًا، التركيز داخل القائمة نفسها — لا يبقى على الزر قبل الإغلاق
  expect(menuElement.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement ?? menuElement, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('keeps an 8px gutter from the viewport edge on every side', async () => {
  render(menu({ name: 'Sara', email: 'sara@example.com' }));
  openAccountMenu();
  await screen.findByRole('menu', { name: 'Account menu' });
  const wrapper = document.querySelector<HTMLElement>('[data-radix-popper-content-wrapper]');
  // jsdom has a zero-size viewport, so the space Radix reports is 0 minus the 8px padding on both sides.
  expect(wrapper?.style.getPropertyValue('--radix-popper-available-width')).toBe('-16px');
  expect(wrapper?.style.getPropertyValue('--radix-popper-available-height')).toBe('-16px');
});

it('carries the full name and email as titles, because the menu truncates them', async () => {
  const email = 'a.very.long.address.for.a.long.named.person@example-company.test';
  render(menu({ name: 'Sara Ali Al-Mutairi Al-Sabah', email }));
  openAccountMenu();
  await screen.findByRole('menu', { name: 'Account menu' });
  expect(screen.getByText('Sara Ali Al-Mutairi Al-Sabah').getAttribute('title')).toBe(
    'Sara Ali Al-Mutairi Al-Sabah',
  );
  expect(screen.getByText(email).getAttribute('title')).toBe(email);
});
