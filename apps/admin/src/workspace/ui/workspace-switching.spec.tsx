import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { WorkspaceBranch, WorkspaceCompany } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSelection, writeSelection } from '@/shared/api/selection-cookie';
import { QueryProvider } from '@/shared/api/query-provider';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { WorkspaceProvider } from '../model/workspace-provider';
import { FrameWorkspaceSwitcher } from '../../../app/(dashboard)/_frame/frames/frame-workspace-switcher';
import { WorkspaceBody } from './workspace-body';

if (typeof window !== 'undefined') {
  window.Element.prototype.scrollIntoView = () => undefined;
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => undefined;
  window.HTMLElement.prototype.releasePointerCapture = () => undefined;
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
  useParams: () => ({}),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  notFound: (): never => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const activeBranch: WorkspaceBranch = {
  id: '01923f66-3d2b-7c00-8000-000000000111',
  name_ar: null,
  name_en: 'Active Branch',
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};

const firstCompany: WorkspaceCompany = {
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
      business_type: 'salon',
      country: null,
      branches: [activeBranch],
    },
  ],
};

const secondCompany: WorkspaceCompany = {
  id: '01923f66-3d2b-7c00-8000-000000000002',
  name_ar: null,
  name_en: 'Second Company',
  role_code: 'owner',
  scope: 'COMPANY',
  businesses: [],
};

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const label = (key: Parameters<typeof t>[1]) => t('en', key);

function makeResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** يرسم المبدّل الحقيقي مع مزوّد مساحة العمل الحقيقي فوق قراءة الـ API المحاكاة، وصفحة خلف بوابة المساحة. */
function renderWorkspace(): void {
  render(
    <DirectionProvider dir="ltr">
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <QueryProvider>
          <WorkspaceProvider>
            <FrameWorkspaceSwitcher />
            <WorkspaceBody>
              <p>Workspace content</p>
            </WorkspaceBody>
          </WorkspaceProvider>
        </QueryProvider>
      </LocaleProvider>
    </DirectionProvider>,
  );
}

async function chooseCompany(name: string): Promise<void> {
  const dialog = screen.getByRole('dialog', { name: label('adminNav.workspacesLabel') });
  const companyTrigger = within(dialog).getByRole('combobox', { name: label('admin.companyLabel') });
  fireEvent.keyDown(companyTrigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name });
  fireEvent.click(option);
}

beforeEach(() => {
  clearSelection();
  mockFetch.mockReset();
});

afterAll(() => {
  clearSelection();
});

describe('workspace switching with the real provider and the frame switcher', () => {
  it('shows a saved company, business and branch selected after load, with the page content beside the switcher', async () => {
    writeSelection({
      companyId: firstCompany.id,
      businessId: firstCompany.businesses[0]?.id,
      branchId: activeBranch.id,
    });
    mockFetch.mockImplementation(async () => makeResponse({ companies: [firstCompany, secondCompany] }));

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Workspace content')).toBeTruthy());
    expect(screen.getByRole('button', { name: /First Business/ }).textContent).toContain('Active Branch');

    fireEvent.click(screen.getByRole('button', { name: /First Business/ }));
    const dialog = screen.getByRole('dialog', { name: label('adminNav.workspacesLabel') });
    expect(
      within(dialog).getByRole('combobox', { name: label('admin.companyLabel') }).textContent,
    ).toContain('First Company');
    expect(
      within(dialog).getByRole('combobox', { name: label('admin.businessLabel') }).textContent,
    ).toContain('First Business');
    expect(
      within(dialog).getByRole('combobox', { name: label('admin.branchLabel') }).textContent,
    ).toContain('Active Branch');
  });

  it('leaves no business or branch choice and disables the branch field after picking a company without businesses', async () => {
    writeSelection({
      companyId: firstCompany.id,
      businessId: firstCompany.businesses[0]?.id,
      branchId: activeBranch.id,
    });
    mockFetch.mockImplementation(async () => makeResponse({ companies: [firstCompany, secondCompany] }));

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Workspace content')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /First Business/ }));
    await chooseCompany('Second Company');

    const dialog = screen.getByRole('dialog', { name: label('adminNav.workspacesLabel') });
    const businessTrigger = within(dialog).getByRole('combobox', { name: label('admin.businessLabel') });
    const branchTrigger = within(dialog).getByRole('combobox', { name: label('admin.branchLabel') });
    expect(businessTrigger.textContent ?? '').not.toContain('First Business');
    expect(branchTrigger.textContent ?? '').not.toContain('Active Branch');
    expect(branchTrigger.getAttribute('aria-disabled') === 'true' || branchTrigger.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('First Business')).toBeNull();
    expect(screen.queryByText('Active Branch')).toBeNull();
    expect(screen.getByText(label('admin.chooseBusiness'))).toBeTruthy();
  });
});
