import { vi } from 'vitest';

import type { WorkspaceController } from '@/workspace/model/workspace-provider';

export const REF = '01920000-0000-7000-8000-0000000000a2';

/** ما تقرؤه محاكيات الاختبار: مساحة العمل والمستخدم المسجّل. */
export const carriedState = {
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
};

/** عميل API المحاكى الذي تقرأ منه كل القراءات خلف شروط الظهور. */
export const carriedApi = { GET: vi.fn() };

export const apiClientMock = { apiClient: () => carriedApi };
export const sessionUserMock = { useSessionUser: () => carriedState.userId };
export const workspaceReadMock = { useWorkspace: () => carriedState.workspace };

export function readyWorkspace(withBusiness = true): WorkspaceController {
  return {
    status: 'ready',
    company: {
      id: REF,
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'owner',
      scope: 'COMPANY',
    },
    business: withBusiness
      ? {
          id: REF,
          name_ar: null,
          name_en: 'Synthetic business',
          business_type: 'salon',
          country: null,
          branches: [],
        }
      : undefined,
    branch: undefined,
    companies: [],
    choose: vi.fn(),
  };
}
