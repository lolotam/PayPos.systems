import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { CustomerImportRoute } from './customer-import-route';

const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
  choose: vi.fn(),
  props: vi.fn(),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('@/customers/pages/customer-import-page', () => ({
  CustomerImportPage: (props: { branchId?: string }) => {
    state.props(props);
    return <span>{props.branchId ?? 'business'}</span>;
  },
}));

const branch = {
  id: '01920000-0000-7000-8000-0000000000b1',
  name_ar: null,
  name_en: 'East',
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};

function workspaceWith(companyScope: 'BUSINESS' | 'BRANCH', businessScope: 'BUSINESS' | 'BRANCH') {
  return {
    status: 'ready' as const,
    company: {
      id: '01920000-0000-7000-8000-000000000001',
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'business_manager',
      scope: companyScope,
    },
    business: {
      id: '01920000-0000-7000-8000-000000000002',
      name_ar: null,
      name_en: 'Synthetic business',
      business_type: 'salon' as const,
      country: null,
      branches: [branch],
      scope: businessScope,
    },
    branch: undefined,
    companies: [],
    choose: state.choose,
  };
}

beforeEach(() => {
  state.userId = 'user';
  state.props.mockClear();
  state.choose.mockClear();
  state.workspace = workspaceWith('BUSINESS', 'BRANCH');
});

it('asks for a branch when the business is reached only through one', () => {
  render(<CustomerImportRoute />);
  expect(screen.getByText(t('en', 'customerImport.chooseBranch'))).toBeTruthy();
  expect(state.props).not.toHaveBeenCalled();
});

it('imports on the branch when the business is reached only through one', () => {
  if (state.workspace?.status !== 'ready') throw new Error('Missing fixture');
  state.workspace = { ...state.workspace, branch };
  render(<CustomerImportRoute />);
  expect(screen.getByText(branch.id)).toBeTruthy();
  expect(state.props.mock.calls.at(-1)?.[0].branchId).toBe(branch.id);
});

it('imports on the whole business when the user reaches it', () => {
  state.workspace = workspaceWith('BUSINESS', 'BUSINESS');
  render(<CustomerImportRoute />);
  expect(screen.getByText('business')).toBeTruthy();
  expect(state.props.mock.calls.at(-1)?.[0].branchId).toBeUndefined();
});
