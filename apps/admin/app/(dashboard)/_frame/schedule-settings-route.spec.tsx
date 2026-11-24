import type { WorkspaceBranch } from '@pospay/contracts';
import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScheduleSettingsRoute } from './schedule-settings-route';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));

const companyId = '01920000-0000-7000-8000-000000000301';
const businessId = '01920000-0000-7000-8000-000000000302';
const branchId = '01920000-0000-7000-8000-000000000303';
const otherBranchId = '01920000-0000-7000-8000-000000000304';
const limitLabel = t('en', 'shell.schedule_settings_limit');
const branchLimitLabel = t('en', 'shell.schedule_settings_branch_limit');

const branch = (id: string, name: string): WorkspaceBranch => ({
  id,
  name_ar: null,
  name_en: name,
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
});

function readyWorkspace(selected: WorkspaceBranch): WorkspaceController {
  return {
    status: 'ready',
    company: {
      id: companyId,
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'owner',
      scope: 'COMPANY',
    },
    business: {
      id: businessId,
      name_ar: null,
      name_en: 'Synthetic business',
      business_type: 'salon',
      country: null,
      branches: [
        branch(branchId, 'Synthetic branch'),
        branch(otherBranchId, 'Synthetic other branch'),
      ],
    },
    branch: selected,
    companies: [],
    choose: vi.fn(),
  };
}

function answerRead(path: string) {
  if (path === '/v1/businesses/{businessId}/schedule-settings') {
    return {
      data: {
        business_id: businessId,
        max_shifts_per_day: 3,
        is_default: true,
        updated_at: null,
        // الفرعان بنفس الحد المحفوظ، عشان تتبان حالة "القيمة الجديدة زي القديمة".
        branches: [
          { branch_id: branchId, max_shifts_per_day: 3, source: 'branch', updated_at: null },
          {
            branch_id: otherBranchId,
            max_shifts_per_day: 3,
            source: 'branch',
            updated_at: null,
          },
        ],
      },
      response: { status: 200, ok: true },
    };
  }
  if (path === '/v1/me/workspaces') {
    return {
      data: {
        companies: [
          {
            id: companyId,
            name_ar: null,
            name_en: 'Synthetic company',
            role_code: 'owner',
            scope: 'COMPANY',
            businesses: [
              {
                id: businessId,
                name_ar: null,
                name_en: 'Synthetic business',
                business_type: 'salon',
                country: null,
                branches: [
                  branch(branchId, 'Synthetic branch'),
                  branch(otherBranchId, 'Synthetic other branch'),
                ],
              },
            ],
          },
        ],
      },
      response: { status: 200, ok: true },
    };
  }
  return { data: undefined, response: { status: 404, ok: false } };
}

function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const route = () => (
    <QueryClientProvider client={client}>
      <ScheduleSettingsRoute />
    </QueryClientProvider>
  );
  const view = render(route());
  return {
    client,
    ...view,
    rerenderRoute() {
      view.rerender(route());
    },
  };
}

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.GET.mockImplementation((path: string) => Promise.resolve(answerRead(path)));
  state.userId = 'user';
  state.workspace = readyWorkspace(branch(branchId, 'Synthetic branch'));
});

it('keeps the business draft and shows the saved number of the picked branch', async () => {
  const view = renderRoute();
  const businessInput = (await screen.findByLabelText(limitLabel)) as HTMLInputElement;
  const branchInput = (await screen.findByLabelText(branchLimitLabel)) as HTMLInputElement;
  expect(branchInput.value).toBe('3');
  fireEvent.change(businessInput, { target: { value: '4' } });
  fireEvent.change(branchInput, { target: { value: '2' } });

  state.workspace = readyWorkspace(branch(otherBranchId, 'Synthetic other branch'));
  view.rerenderRoute();

  expect((screen.getByLabelText(limitLabel) as HTMLInputElement).value).toBe('4');
  expect((screen.getByLabelText(branchLimitLabel) as HTMLInputElement).value).toBe('3');
});
