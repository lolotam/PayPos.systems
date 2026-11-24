import { t } from '@pospay/i18n';
import { readThemePreference, setThemePreference } from '@pospay/ui';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { useNavStyle } from '../nav-style/nav-style-context';
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

function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') }), {
    key: 'Enter',
  });
  return screen.getByRole('menu');
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
  const menu = openMenu();
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
  expect(within(menu).getAllByRole('menuitem')).toHaveLength(9);
});

it('marks the current style in words and switches it without a reload', () => {
  renderFrame(
    <>
      <FrameActions />
      <Probe />
    </>,
  );
  let menu = openMenu();
  const styleItems = within(menu).getAllByRole('menuitem', {
    name: new RegExp(label('adminNav.accountMenuStyle')),
  });
  expect(styleItems.map((item) => item.textContent)).toEqual([
    `${label('adminNav.accountMenuStyle')}: ${label('adminNav.styleALabel')}`,
    `${label('adminNav.accountMenuStyle')}: ${label('adminNav.styleBLabel')}`,
    `${label('adminNav.accountMenuStyle')}: ${label('adminNav.styleCLabel')} — ${label('adminNav.currentStyleBadge')}`,
  ]);
  fireEvent.click(styleItems[0] as HTMLElement);
  expect(screen.getByText('Style in use: A')).toBeTruthy();
  menu = openMenu();
  expect(
    within(menu).getByRole('menuitem', {
      name: new RegExp(`${label('adminNav.styleALabel')} — `),
    }),
  ).toBeTruthy();
});

it('shows the fixed save-failure alert after switching from the account menu entry', async () => {
  preferencesApi.put.mockResolvedValueOnce({ error: {}, response: { ok: false } });
  renderFrame(
    <>
      <FrameActions />
      <Probe />
    </>,
  );
  fireEvent.click(
    within(openMenu()).getByRole('menuitem', {
      name: new RegExp(label('adminNav.accountMenuStyle')),
    }),
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
    </>,
  );
  fireEvent.click(
    within(openMenu()).getByRole('menuitem', {
      name: new RegExp(label('adminNav.accountMenuStyle')),
    }),
  );
  expect(screen.getByText('Style in use: A')).toBeTruthy();
  await waitFor(() => expect(preferencesApi.put).toHaveBeenCalledTimes(1));
  expect(preferencesApi.put.mock.calls[0]?.slice(0, 2)).toEqual([
    '/v1/me/preferences',
    { body: { navStyle: 'A' }, signal: expect.any(AbortSignal) },
  ]);
});

it('applies the theme choice and marks the current one', () => {
  renderFrame(<FrameActions />);
  const menu = openMenu();
  fireEvent.click(within(menu).getByRole('menuitem', { name: new RegExp(label('theme.dark')) }));
  expect(readThemePreference()).toBe('dark');
  const reopened = openMenu();
  expect(
    within(reopened).getByRole('menuitem', { name: new RegExp(`${label('theme.dark')} — `) }),
  ).toBeTruthy();
});

it('signs out from the last entry and shows a failure in its text', () => {
  const { rerenderFrame } = renderFrame(<FrameActions />);
  fireEvent.click(within(openMenu()).getByRole('menuitem', { name: label('admin.signOut') }));
  expect(signOut.submit).toHaveBeenCalledTimes(1);
  signOut.failed = true;
  act(() => rerenderFrame(<FrameActions />));
  expect(
    within(openMenu()).getByRole('menuitem', {
      name: `${label('admin.signOut')} — ${label('admin.unexpected')}`,
    }),
  ).toBeTruthy();
});

it('keeps the other frame controls beside the menu', () => {
  renderFrame(<FrameActions />);
  expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Switch language' })).toBeTruthy();
});

it('closes the account menu on every navigation, Back included, and keeps the same trigger', () => {
  renderFrame(<FrameActions />);
  const trigger = screen.getByRole('button', { name: label('adminNav.accountMenuLabel') });
  openMenu();
  goTo('/leave');
  expect(screen.queryByRole('menu')).toBeNull();
  openMenu();
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
  ['account menu', () => <FrameActions />, 'menu'],
  ['workspace switcher', () => <FrameWorkspaceSwitcher />, 'dialog'],
])(
  'closes the %s on a query-only or fragment-only move, Back and Forward included',
  (_name, frame, role) => {
    frameState.pathname = '/packages';
    renderFrame(frame());
    const trigger = screen.getByRole('button', {
      name: role === 'menu' ? label('adminNav.accountMenuLabel') : /Synthetic business/,
    });
    const open = () => {
      if (role === 'menu') openMenu();
      else fireEvent.click(screen.getByRole('button', { name: /Synthetic business/ }));
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
