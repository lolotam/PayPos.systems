import { t } from '@pospay/i18n';
import { readThemePreference, setThemePreference } from '@pospay/ui';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { useNavStyle } from '../nav-style/nav-style-context';
import { NavStyleSaveNotice } from '../nav-style/nav-style-save-notice';
import { FrameActions } from './frame-actions';
import { frameState, goTo, renderFrame, resetFrameState } from './frame-test-support';
import { FrameWorkspaceSwitcher } from './frame-workspace-switcher';

const signOut = vi.hoisted(() => ({
  pending: false,
  failed: false,
  submit: vi.fn(() => Promise.resolve()),
}));
const preferencesApi = vi.hoisted(() => ({ put: vi.fn() }));

vi.mock('next/navigation', async () => (await import('./frame-test-support')).navigationMock);
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PUT: preferencesApi.put }) }));
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('./frame-test-support')).localeMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('./frame-test-support')).workspaceMock,
);
vi.mock(
  '@/session/api/use-session',
  async () => (await import('./frame-test-support')).sessionMock,
);
vi.mock('@/session/api/use-sign-out', () => ({ useSignOut: () => signOut }));
vi.mock(
  '@/notifications/ui/notification-bell',
  async () => (await import('./frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('./frame-test-support')).localeSwitchMock,
);

const label = (key: Parameters<typeof t>[1]) => t('en', key);

function Probe() {
  return <p>Style in use: {useNavStyle().style}</p>;
}

function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
  return screen.getByRole('menu');
}

const openAccountMenu = () => openMenu(label('adminNav.accountMenuLabel'));
const openStyleMenu = () => openMenu(label('adminNav.accountMenuStyle'));

/**
 * يضبط وضع النظام المخبوز في المتصفح ويعيد تركيب مشغّل الوضع، عشان الاختبار
 * يقرأ حالة الصفحة من غير ما يعتمد على مشغّل مركّب من اختبار قبله.
 */
function stubSystemTheme(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-color-scheme: dark') ? dark : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  window.__pospayTheme?.dispose();
}

beforeEach(() => {
  resetFrameState();
  signOut.pending = false;
  signOut.failed = false;
  signOut.submit.mockClear();
  preferencesApi.put.mockReset();
  preferencesApi.put.mockResolvedValue({ response: { ok: true } });
  setThemePreference('system');
});

it('shows the name, email, links and every choice in order', () => {
  renderFrame(<FrameActions />);
  const menu = openAccountMenu();
  expect(within(menu).getByText('Sara Ali')).toBeTruthy();
  expect(within(menu).getByText('sara@example.test')).toBeTruthy();
  expect(
    within(menu)
      .getByRole('menuitem', { name: label('admin.enrolLink') })
      .getAttribute('href'),
  ).toBe('/security/two-factor');
  expect(
    within(menu)
      .getByRole('menuitem', { name: label('adminNav.appearanceTitle') })
      .getAttribute('href'),
  ).toBe('/appearance');
  const items = within(menu).getAllByRole('menuitem');
  expect(items).toHaveLength(3);
  expect(items.map((item) => item.getAttribute('data-account-entry'))).toEqual([
    'authenticator',
    'appearance',
    'sign-out',
  ]);
  // اختيار النمط والوضع بقى في الشريط العلوي، فمفيش مدخل لهما في قائمة الحساب
  expect(
    items.filter((item) => /^(style-|theme-)/.test(item.getAttribute('data-account-entry') ?? '')),
  ).toHaveLength(0);
});

it('marks the current style in the header dropdown and switches it without a reload', () => {
  renderFrame(
    <>
      <FrameActions />
      <Probe />
    </>,
  );
  let menu = openStyleMenu();
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    label('adminNav.styleALabel'),
    label('adminNav.styleBLabel'),
    `✓ ${label('adminNav.styleCLabel')}`,
  ]);
  fireEvent.click(within(menu).getByRole('menuitem', { name: label('adminNav.styleALabel') }));
  expect(screen.getByText('Style in use: A')).toBeTruthy();
  menu = openStyleMenu();
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    `✓ ${label('adminNav.styleALabel')}`,
    label('adminNav.styleBLabel'),
    label('adminNav.styleCLabel'),
  ]);
});

it('shows the fixed save-failure alert after switching from the header dropdown', async () => {
  preferencesApi.put.mockResolvedValueOnce({ error: {}, response: { ok: false } });
  renderFrame(
    <>
      <FrameActions />
      <Probe />
      <NavStyleSaveNotice />
    </>,
  );
  fireEvent.click(
    within(openStyleMenu()).getByRole('menuitem', { name: label('adminNav.styleALabel') }),
  );
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(t('en', 'adminNav.saveFailed'));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByText('Style in use: A')).toBeTruthy();
});

it('a user with no ready workspace switches through the provider tree and sends one PUT', async () => {
  frameState.workspace = { status: 'choose', companies: [], choose: vi.fn() } as never;
  renderFrame(
    <>
      <FrameActions />
      <Probe />
      <NavStyleSaveNotice />
    </>,
  );
  fireEvent.click(
    within(openStyleMenu()).getByRole('menuitem', { name: label('adminNav.styleALabel') }),
  );
  expect(screen.getByText('Style in use: A')).toBeTruthy();
  await waitFor(() => expect(preferencesApi.put).toHaveBeenCalledTimes(1));
  expect(preferencesApi.put.mock.calls[0]?.slice(0, 2)).toEqual([
    '/v1/me/preferences',
    { body: { navStyle: 'A' }, signal: expect.any(AbortSignal) },
  ]);
});

it('toggles the display theme from the header in one click, with no theme menu', () => {
  stubSystemTheme(false);
  renderFrame(<FrameActions />);
  const toggle = () => screen.getByRole('button', { name: label('adminNav.accountMenuTheme') });
  expect(toggle().querySelector('[data-theme-icon="moon"]')).toBeTruthy();
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  fireEvent.click(toggle());
  expect(readThemePreference()).toBe('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(toggle().querySelector('[data-theme-icon="sun"]')).toBeTruthy();
  fireEvent.click(toggle());
  expect(readThemePreference()).toBe('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(toggle().querySelector('[data-theme-icon="moon"]')).toBeTruthy();
});

it('fixes an explicit theme when the preference follows the system', () => {
  stubSystemTheme(true);
  renderFrame(<FrameActions />);
  const toggle = () => screen.getByRole('button', { name: label('adminNav.accountMenuTheme') });
  expect(toggle().querySelector('[data-theme-icon="sun"]')).toBeTruthy();
  fireEvent.click(toggle());
  expect(readThemePreference()).toBe('light');
  expect(toggle().querySelector('[data-theme-icon="moon"]')).toBeTruthy();
});

it('signs out from the last entry and shows a failure in its text', () => {
  const { rerenderFrame } = renderFrame(<FrameActions />);
  fireEvent.click(within(openAccountMenu()).getByRole('menuitem', { name: label('admin.signOut') }));
  expect(signOut.submit).toHaveBeenCalledTimes(1);
  signOut.failed = true;
  act(() => rerenderFrame(<FrameActions />));
  expect(
    within(openAccountMenu()).getByRole('menuitem', {
      name: `${label('admin.signOut')} — ${label('admin.unexpected')}`,
    }),
  ).toBeTruthy();
});

it('keeps the other frame controls beside the menu', () => {
  renderFrame(<FrameActions />);
  expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
  expect(screen.getByRole('button', { name: label('adminNav.accountMenuStyle') })).toBeTruthy();
  expect(screen.getByRole('button', { name: label('adminNav.accountMenuTheme') })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Switch language' })).toBeTruthy();
});

it('keeps the header controls in order: bell, style, theme, language, account', () => {
  renderFrame(<FrameActions />);
  const bell = screen.getByRole('button', { name: 'Notifications' });
  const group = bell.parentElement as HTMLElement;
  expect(
    Array.from(group.children).map(
      (child) => child.getAttribute('aria-label') ?? child.textContent ?? '',
    ),
  ).toEqual([
    'Notifications',
    label('adminNav.accountMenuStyle'),
    label('adminNav.accountMenuTheme'),
    'Switch language',
    label('adminNav.accountMenuLabel'),
  ]);
});

it('gives the style and theme buttons a 44px target, a tooltip and no shrinking', () => {
  renderFrame(<FrameActions />);
  for (const key of ['adminNav.accountMenuStyle', 'adminNav.accountMenuTheme'] as const) {
    const button = screen.getByRole('button', { name: label(key) });
    expect(button.className).toContain('size-11');
    expect(button.className).toContain('shrink-0');
    expect(button.getAttribute('title')).toBe(label(key));
  }
});

it('closes the account menu on every navigation, Back included, and keeps the same trigger', () => {
  renderFrame(<FrameActions />);
  const trigger = screen.getByRole('button', { name: label('adminNav.accountMenuLabel') });
  openAccountMenu();
  goTo('/leave');
  expect(screen.queryByRole('menu')).toBeNull();
  openAccountMenu();
  goTo('/');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') })).toBe(trigger);
});

it('closes the workspace switcher on every navigation, Back included, and keeps the same trigger', () => {
  frameState.pathname = '/staff';
  renderFrame(<FrameWorkspaceSwitcher />);
  const trigger = screen.getByRole('button', { name: /Synthetic business/ });
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog')).toBeTruthy();
  goTo('/leave');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  goTo('/staff');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: /Synthetic business/ })).toBe(trigger);
});

it('names the workspace switcher by a prompt until a company and a business are selected', () => {
  frameState.workspace = { status: 'choose', companies: [], choose: vi.fn() };
  const { rerenderFrame } = renderFrame(<FrameWorkspaceSwitcher />);
  expect(screen.getByRole('button', { name: label('admin.chooseCompany') })).toBeTruthy();
  const company = { id: 'company-1', name_ar: null, name_en: 'Synthetic company' };
  frameState.workspace = {
    status: 'ready',
    company: { ...company, role_code: 'owner', scope: 'COMPANY', businesses: [] },
    companies: [],
    choose: vi.fn(),
  };
  rerenderFrame(<FrameWorkspaceSwitcher />);
  expect(screen.getByRole('button', { name: label('admin.chooseBusiness') })).toBeTruthy();
});

it.each([
  ['account menu', () => <FrameActions />, 'menu', label('adminNav.accountMenuLabel')],
  ['style menu', () => <FrameActions />, 'menu', label('adminNav.accountMenuStyle')],
  ['workspace switcher', () => <FrameWorkspaceSwitcher />, 'dialog', /Synthetic business/],
])(
  'closes the %s on a query-only or fragment-only move, Back and Forward included',
  (_name, frame, role, triggerName) => {
    frameState.pathname = '/packages';
    renderFrame(frame());
    const trigger = screen.getByRole('button', { name: triggerName });
    const open = () => {
      if (role === 'menu') fireEvent.keyDown(trigger, { key: 'Enter' });
      else fireEvent.click(trigger);
      expect(screen.getByRole(role)).toBeTruthy();
    };
    open();
    goTo('/packages?package=1');
    expect(screen.queryByRole(role)).toBeNull();
    open();
    goTo('/packages');
    expect(screen.queryByRole(role)).toBeNull();
    open();
    goTo('/packages?package=2');
    expect(screen.queryByRole(role)).toBeNull();
    open();
    goTo('/packages?package=2#pending');
    expect(screen.queryByRole(role)).toBeNull();
    open();
    goTo('/packages?package=2');
    expect(screen.queryByRole(role)).toBeNull();
    expect(trigger.isConnected).toBe(true);
  },
);
