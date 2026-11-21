import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ImportedRefundsPage } from './imported-refunds-page';

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  PUT: vi.fn(),
}));
const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));

const id = '01920000-0000-7000-8000-0000000000c1';
const heading = t('en', 'importedRefunds.title');
const label = t('en', 'importedRefunds.label');
const offNote = t('en', 'importedRefunds.offNote');
const refused = t('en', 'importedRefunds.notAllowed');

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <ImportedRefundsPage companyId={id} userId="user" businessId={id} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.GET.mockResolvedValue({
    data: { imported_refunds_enabled: false },
    response: { status: 200 },
  });
  state.userId = 'user';
  state.workspace = {
    status: 'ready',
    company: {
      id,
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'owner',
      scope: 'COMPANY',
    },
    business: { id, name_ar: null, name_en: 'Synthetic business', branches: [] },
    branch: undefined,
    companies: [],
    choose: vi.fn(),
  };
});

it('shows the switch off with the off note for a business that never touched it', async () => {
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  expect((control as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('status').textContent).toContain(offNote);
  expect(screen.getByRole('heading', { name: heading }).textContent).toBe(heading);
});

it('shows the switch on after the server confirms a save', async () => {
  api.GET.mockResolvedValue({
    data: { imported_refunds_enabled: true },
    response: { status: 200 },
  });
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  expect((control as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole('status')).toBeNull();
});

it('a failed save brings back the last value the server confirmed, with an error message', async () => {
  api.PUT.mockResolvedValue({ error: { code: 'INTERNAL_ERROR' }, response: { status: 500 } });
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  fireEvent.click(control);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  await waitFor(() =>
    expect((screen.getByRole('switch', { name: label }) as HTMLInputElement).checked).toBe(false),
  );
  expect(screen.getByRole('status').textContent).toContain(offNote);
  expect(api.PUT).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/settings/imported-refunds',
    expect.objectContaining({
      params: expect.objectContaining({ path: { businessId: id } }),
      body: { imported_refunds_enabled: true },
    }),
  );
});

it('a 403 read shows a not-allowed message with no control', async () => {
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderPage();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(refused));
  expect(screen.queryByRole('switch')).toBeNull();
});
