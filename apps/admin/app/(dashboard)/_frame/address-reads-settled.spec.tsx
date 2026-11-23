import { t } from '@pospay/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deferredAnswer } from '@/commissions/api/__tests__/plan-http';

import { carriedApi, carriedState, readyWorkspace } from './menu/carried-mocks';
import { newClient } from './menu/carried-reads-support';
import { frameState, renderFrame, resetFrameState } from './frames/frame-test-support';
import { NotFoundProbe } from './frames/not-found-probe';
import { OverviewRoute } from './overview-route';
import { SoonRoute } from './soon-route';

vi.mock('@/shared/api/client', async () => (await import('./menu/carried-mocks')).apiClientMock);
vi.mock('next/navigation', async () => (await import('./frames/frame-test-support')).navigationMock);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('./frames/frame-test-support')).localeMock,
);
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock(
  '@/session/api/use-session',
  async () => (await import('./menu/carried-mocks')).sessionUserMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('./menu/carried-mocks')).workspaceReadMock,
);

const IDENTITY_PATH = '/v1/businesses/{businessId}/settings/identity-capability';
const refusal = {
  error: { code: 'FORBIDDEN', message_ar: 'x', message_en: 'x' },
  response: { status: 403 },
};

// القراءة الوحيدة المتأخرة هي قدرة هوية النشاط؛ كل قراءة أخرى ترفض فورًا فتستقر.
function answerWithLateIdentity() {
  const late = deferredAnswer();
  carriedApi.GET.mockImplementation((path: string) =>
    path === IDENTITY_PATH ? late.promise : Promise.resolve(refusal),
  );
  return late;
}

function renderRoute(route: 'overview' | 'soon', id: string) {
  frameState.pathname = `/${route}/${id}`;
  frameState.params = route === 'overview' ? { group: id } : { page: id };
  return renderFrame(
    <QueryClientProvider client={newClient()}>
      <NotFoundProbe>{route === 'overview' ? <OverviewRoute /> : <SoonRoute />}</NotFoundProbe>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetFrameState();
  carriedApi.GET.mockReset();
  carriedState.userId = 'user';
  carriedState.workspace = readyWorkspace();
});

describe('an address that depends on a read that has not answered yet', () => {
  it('goes to the built page, not to the not-built page that is first before the read arrives', async () => {
    const late = answerWithLateIdentity();
    renderRoute('overview', 'setup');
    await waitFor(() => expect(carriedApi.GET).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toBe(t('en', 'admin.loading'));
    expect(frameState.replace).not.toHaveBeenCalled();
    await act(async () => {
      late.resolve({ data: { can_manage_identity: true }, response: { status: 200, ok: true } });
    });
    await waitFor(() => expect(frameState.pathname).toBe('/business-identity'));
  });

  it('settles on the first not-built page when the read refuses', async () => {
    const late = answerWithLateIdentity();
    renderRoute('overview', 'setup');
    await waitFor(() => expect(carriedApi.GET).toHaveBeenCalled());
    await act(async () => {
      late.resolve({ data: { can_manage_identity: false }, response: { status: 200, ok: true } });
    });
    await waitFor(() => expect(frameState.replace).toHaveBeenCalledTimes(1));
    expect(frameState.pathname).not.toBe('/business-identity');
  });

  it('does not say not found for an unknown Soon address while reads are loading', async () => {
    const late = answerWithLateIdentity();
    renderRoute('soon', 'no-such-page');
    await waitFor(() => expect(carriedApi.GET).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toBe(t('en', 'admin.loading'));
    expect(screen.queryByText('Not found')).toBeNull();
    await act(async () => {
      late.resolve({ data: { can_manage_identity: true }, response: { status: 200, ok: true } });
    });
    expect(await screen.findByText('Not found')).toBeTruthy();
  });
});
