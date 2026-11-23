import { t } from '@pospay/i18n';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { frameState, renderFrame, resetFrameState, stubViewport } from './frame-test-support';
import { StyleAFrame } from './style-a-frame';
import { StyleBFrame } from './style-b-frame';
import { StyleCFrame } from './style-c-frame';

vi.mock('next/navigation', async () => (await import('./frame-test-support')).navigationMock);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('./frame-test-support')).localeMock,
);
vi.mock(
  '../menu/use-visible-page-ids',
  async () => (await import('./frame-test-support')).visibleMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('./frame-test-support')).workspaceMock,
);
vi.mock(
  '@/session/api/use-session',
  async () => (await import('./frame-test-support')).sessionMock,
);
vi.mock(
  '@/session/api/use-sign-out',
  async () => (await import('./frame-test-support')).signOutMock,
);
vi.mock(
  '@/notifications/ui/notification-bell',
  async () => (await import('./frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('./frame-test-support')).localeSwitchMock,
);

const label = (key: Parameters<typeof t>[1]) => t('en', key);

// jsdom has no layout engine: these tests pin the structure that keeps the bar inside the screen.
// The widths themselves (360 to 1100px) are a browser check.
beforeEach(() => {
  resetFrameState();
  stubViewport(390);
  frameState.pathname = '/staff';
});

describe.each([
  ['A', StyleAFrame],
  ['B', StyleBFrame],
  ['C', StyleCFrame],
] as const)('the top bar of style %s on a phone', (_style, Frame) => {
  it('lets the workspace switcher shrink and truncate while the actions keep their size', () => {
    renderFrame(<Frame>Page body</Frame>);
    const switcher = screen.getByRole('button', { name: /Synthetic business/ });
    const switcherBox = switcher.parentElement as HTMLElement;
    expect(switcherBox.className).toContain('min-w-0');
    expect(switcherBox.className).toContain('flex-[1_1_10rem]');
    const actions = screen.getByRole('button', { name: label('adminNav.accountMenuLabel') })
      .parentElement as HTMLElement;
    expect(actions.className).toContain('shrink-0');
    expect(actions.parentElement?.className).toContain('flex-wrap');
  });

  it('keeps the account menu button from shrinking below its 44px size', () => {
    renderFrame(<Frame>Page body</Frame>);
    const trigger = screen.getByRole('button', { name: label('adminNav.accountMenuLabel') });
    expect(trigger.className).toContain('size-11');
    expect(trigger.className).toContain('shrink-0');
  });
});

describe('the phone navigation button of style B', () => {
  it('is a full target and sits in a cell that cannot go below its width', () => {
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const button = screen.getByRole('button', { name: label('shell.openNavigation') });
    expect(button.className).toContain('size-11');
    expect(button.className).toContain('shrink-0');
    const cell = button.closest('div.flex-1') as HTMLElement;
    expect(cell.className).toContain('min-w-[3.75rem]');
  });
});
