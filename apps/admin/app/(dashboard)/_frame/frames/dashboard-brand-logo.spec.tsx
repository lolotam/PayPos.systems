import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NavStyleProvider } from '../nav-style/nav-style-context';

import { frameState, renderFrame, resetFrameState, stubViewport } from './frame-test-support';
import { StyleAFrame } from './style-a-frame';
import { StyleBFrame } from './style-b-frame';
import { StyleCFrame } from './style-c-frame';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
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

const FILE_ID = '01920000-0000-7000-8000-0000000000f1';
const SIGNED = 'https://storage.test/signed-logo.png';

function downloadResponse(downloadUrl: string) {
  return { data: { download_url: downloadUrl, expires_in: 60 }, error: undefined, response: { status: 200 } };
}

/** يضبط النشاط المختار، ومنه معرّف الشعار: غايب = النشاط مالوش شعار. */
function selectBusinessWithLogo(logoFileId: string | null) {
  resetFrameState();
  stubViewport(390);
  const workspace = frameState.workspace;
  if (!workspace || workspace.status !== 'ready' || !workspace.business)
    throw new Error('no ready workspace');
  const business = { ...workspace.business, logo_file_id: logoFileId };
  frameState.workspace = {
    ...workspace,
    business,
    company: { ...workspace.company, businesses: [{ ...business }] },
    companies: [{ ...workspace.company, businesses: [{ ...business }] }],
  };
}

function pospayMarks(container: HTMLElement): HTMLImageElement[] {
  return Array.from(
    container.querySelectorAll<HTMLImageElement>('img[src="/brand/logo-mark-simple-tile.png"]'),
  );
}

function renderWithClient(ui: ReactElement, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <NavStyleProvider initialStyle="C">{ui}</NavStyleProvider>
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.POST.mockReset();
  api.POST.mockResolvedValue(downloadResponse(SIGNED));
});

describe('the dashboard header logo without a business logo', () => {
  it.each([
    ['A', StyleAFrame],
    ['B', StyleBFrame],
    ['C', StyleCFrame],
  ] as const)('shows the PosPay mark in style %s and asks for nothing', (_style, Frame) => {
    selectBusinessWithLogo(null);
    const { container } = renderFrame(<Frame>Page body</Frame>);
    expect(pospayMarks(container).length).toBeGreaterThan(0);
    expect(api.POST).not.toHaveBeenCalled();
  });
});

describe('the dashboard header logo with a business logo', () => {
  it('shows the signed logo of the active business', async () => {
    selectBusinessWithLogo(FILE_ID);
    const { container } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    const logo = await screen.findByRole('img', { name: 'Synthetic business' });
    expect(logo.getAttribute('src')).toBe(SIGNED);
    expect(logo.className).toContain('object-contain');
    expect(logo.className).toContain('w-auto');
    expect(pospayMarks(container)).toHaveLength(0);
  });

  it('deduplicates the logo download in style A where the sidebar mark and the topbar mark both mount', async () => {
    selectBusinessWithLogo(FILE_ID);
    // على سطح المكتب بين مركّبتان: علامة الشريط الجانبي وعلامة الشريط العلوي، والنزلة واحدة
    stubViewport(1280);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { container } = renderWithClient(<StyleAFrame>Page body</StyleAFrame>, client);
    const logos = await screen.findAllByRole('img', { name: 'Synthetic business' });
    expect(logos).toHaveLength(2);
    expect(api.POST).toHaveBeenCalledTimes(1);
    expect(pospayMarks(container)).toHaveLength(0);
  });

  it('follows the business switch to the new logo', async () => {
    selectBusinessWithLogo(FILE_ID);
    api.POST.mockImplementation(async (_path: string, options: { params: { path: { id: string } } }) =>
      downloadResponse(`https://storage.test/${options.params.path.id}.png`),
    );
    const { container, rerenderFrame } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    await screen.findByRole('img', { name: 'Synthetic business' });
    selectBusinessWithLogo('01920000-0000-7000-8000-0000000000f2');
    rerenderFrame(<StyleCFrame>Page body</StyleCFrame>);
    const logo = await screen.findByRole('img', { name: 'Synthetic business' });
    expect(logo.getAttribute('src')).toBe(
      'https://storage.test/01920000-0000-7000-8000-0000000000f2.png',
    );
    expect(pospayMarks(container)).toHaveLength(0);
  });

  it('falls back to the PosPay mark when the download fails', async () => {
    selectBusinessWithLogo(FILE_ID);
    api.POST.mockResolvedValue({
      data: undefined,
      error: { message: 'refused' },
      response: { status: 403 },
    });
    const { container } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    await waitFor(() => expect(pospayMarks(container).length).toBeGreaterThan(0));
    expect(screen.queryByRole('img', { name: 'Synthetic business' })).toBeNull();
  });

  it('falls back to the PosPay mark when the image fails to load', async () => {
    selectBusinessWithLogo(FILE_ID);
    const { container } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    const logo = await screen.findByRole('img', { name: 'Synthetic business' });
    act(() => {
      logo.dispatchEvent(new Event('error'));
    });
    await waitFor(() => expect(pospayMarks(container).length).toBeGreaterThan(0));
  });
});

describe('the dashboard header logo and the workspaces cache', () => {
  it('shows the logo again as soon as the identity refresh writes the cache', async () => {
    selectBusinessWithLogo(null);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    client.setQueryData(['me', 'workspaces'], {
      companies: [
        {
          id: 'company-1',
          name_ar: null,
          name_en: 'Synthetic company',
          role_code: 'owner',
          scope: 'COMPANY',
          businesses: [
            {
              id: 'business-1',
              name_ar: null,
              name_en: 'Synthetic business',
              business_type: 'restaurant',
              country: 'KW',
              branches: [],
              logo_file_id: null,
            },
          ],
        },
      ],
      capabilities: { staff_access: false },
    });
    const { container } = renderWithClient(<StyleCFrame>Page body</StyleCFrame>, client);
    expect(pospayMarks(container).length).toBeGreaterThan(0);
    const { refreshBusinessIdentity } = await import('@/business-identity/api/identity-client');
    await act(async () => {
      await refreshBusinessIdentity(client, 'company-1', 'user-1', 'business-1', {
        logo_file_id: FILE_ID,
      });
    });
    const logo = await screen.findByRole('img', { name: 'Synthetic business' });
    expect(logo.getAttribute('src')).toBe(SIGNED);
    await act(async () => {
      await refreshBusinessIdentity(client, 'company-1', 'user-1', 'business-1', {
        logo_file_id: null,
      });
    });
    await waitFor(() => expect(pospayMarks(container).length).toBeGreaterThan(0));
    expect(screen.queryByRole('img', { name: 'Synthetic business' })).toBeNull();
  });
});
