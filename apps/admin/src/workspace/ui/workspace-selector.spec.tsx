import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceBranch, WorkspaceCompany } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSelection, writeSelection } from '@/shared/api/selection-cookie';
import { QueryProvider } from '@/shared/api/query-provider';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { WorkspaceProvider } from '../model/workspace-provider';
import { BranchLabel } from './branch-label';
import { WorkspaceBody } from './workspace-body';
import { WorkspaceSelector } from './workspace-selector';

if (typeof window !== 'undefined') {
  window.Element.prototype.scrollIntoView = () => undefined;
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => undefined;
  window.HTMLElement.prototype.releasePointerCapture = () => undefined;
}

const activeBranch: WorkspaceBranch = {
  id: '01923f66-3d2b-7c00-8000-000000000111',
  name_ar: null,
  name_en: 'Active Branch',
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};

const inactiveBranch: WorkspaceBranch = {
  id: '01923f66-3d2b-7c00-8000-000000000112',
  name_ar: null,
  name_en: 'Inactive Branch',
  effective_timezone: 'Asia/Kuwait',
  is_active: false,
};

const company1: WorkspaceCompany = {
  id: '01923f66-3d2b-7c00-8000-000000000001',
  name_ar: null,
  name_en: 'First Company',
  role_code: 'owner',
  scope: 'COMPANY',
  businesses: [
    {
      id: '01923f66-3d2b-7c00-8000-000000000011',
      name_ar: null,
      name_en: 'First Business',
      branches: [activeBranch, inactiveBranch],
    },
  ],
};

const company2: WorkspaceCompany = {
  id: '01923f66-3d2b-7c00-8000-000000000002',
  name_ar: null,
  name_en: 'Second Company',
  role_code: 'owner',
  scope: 'COMPANY',
  businesses: [],
};

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function renderApp(ui: React.ReactElement) {
  return render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <QueryProvider>{ui}</QueryProvider>
      </LocaleProvider>
    </DirectionProvider>,
  );
}

function makeResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function testBranchLabel(): void {
  it('marks an inactive branch with the inactive badge', () => {
    const { unmount } = renderApp(<BranchLabel branch={activeBranch} />);
    expect(screen.queryByText(t('ar', 'admin.branchInactive'))).toBeNull();
    unmount();

    renderApp(<BranchLabel branch={inactiveBranch} />);
    expect(screen.getByText(t('ar', 'admin.branchInactive'))).not.toBeNull();
  });
}

function testEmptyState(): void {
  it('shows empty workspace state in WorkspaceBody when companies list is empty', async () => {
    mockFetch.mockImplementation(async () => makeResponse({ companies: [] }));

    renderApp(
      <WorkspaceProvider>
        <WorkspaceBody>
          <div data-testid="ready">Ready</div>
        </WorkspaceBody>
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: t('ar', 'admin.workspaceEmptyTitle') })).not.toBeNull();
      expect(screen.getByText(t('ar', 'admin.workspaceEmptyBody'))).not.toBeNull();
    });
  });
}

function testSelectorRender(): void {
  it('renders companies from GET /v1/me/workspaces and enables selectors when selected', async () => {
    writeSelection({
      companyId: company1.id,
      businessId: company1.businesses[0]?.id,
      branchId: inactiveBranch.id,
    });

    mockFetch.mockImplementation(async () => makeResponse({ companies: [company1, company2] }));

    renderApp(
      <WorkspaceProvider>
        <WorkspaceSelector />
        <WorkspaceBody>
          <div data-testid="body-content">Content</div>
        </WorkspaceBody>
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('body-content')).not.toBeNull();
    });

    expect(screen.getByRole('combobox', { name: t('ar', 'admin.companyLabel') })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: t('ar', 'admin.businessLabel') })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: t('ar', 'admin.branchLabel') })).not.toBeNull();
  });
}

function testResetSelection(): void {
  it('resets business and branch selection when changing company', async () => {
    writeSelection({
      companyId: company1.id,
      businessId: company1.businesses[0]?.id,
      branchId: activeBranch.id,
    });

    mockFetch.mockImplementation(async () => makeResponse({ companies: [company1, company2] }));

    renderApp(
      <WorkspaceProvider>
        <WorkspaceSelector />
        <WorkspaceBody>
          <div data-testid="body-content">Content</div>
        </WorkspaceBody>
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('body-content')).not.toBeNull();
    });

    const companyTrigger = screen.getByRole('combobox', { name: t('ar', 'admin.companyLabel') });
    fireEvent.keyDown(companyTrigger, { key: 'ArrowDown' });

    const company2Option = await screen.findByRole('option', { name: company2.name_en });
    fireEvent.click(company2Option);

    await waitFor(() => {
      const branchTrigger = screen.getByRole('combobox', { name: t('ar', 'admin.branchLabel') });
      expect(branchTrigger.getAttribute('aria-disabled') === 'true' || branchTrigger.hasAttribute('disabled')).toBe(true);
    });
  });
}

describe('WorkspaceSelector and UI components', () => {
  beforeEach(() => {
    clearSelection();
    mockFetch.mockReset();
  });

  afterAll(() => {
    clearSelection();
  });

  testBranchLabel();
  testEmptyState();
  testSelectorRender();
  testResetSelection();
});
