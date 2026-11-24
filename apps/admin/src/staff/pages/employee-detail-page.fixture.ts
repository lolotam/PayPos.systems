import type { WorkspaceBusinessRead } from '@pospay/contracts';

export const employeeId = '01920000-0000-7000-8000-0000000000a2';
export const tokyoBranchId = '01920000-0000-7000-8000-0000000000a3';
export const DETAIL_PATH = '/v1/businesses/{businessId}/employees/{employeeId}';

const branch = (id: string, name: string, effective_timezone: string) => ({
  id,
  name_ar: null,
  name_en: name,
  effective_timezone,
  is_active: true,
});

export const business: WorkspaceBusinessRead = {
  id: employeeId,
  name_en: 'Synthetic salon',
  name_ar: null,
  business_type: 'salon',
  country: null,
  branches: [branch(employeeId, 'Synthetic primary', 'Asia/Kuwait')],
};

/** نفس النشاط وفرع آخر يسبق الفرع الأساسي، لإثبات أن منطقة الموظف هي منطقة فرعه الأساسي. */
export const businessWithTokyoFirst: WorkspaceBusinessRead = {
  ...business,
  branches: [branch(tokyoBranchId, 'Synthetic Tokyo branch', 'Asia/Tokyo'), ...business.branches],
};

export function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: employeeId,
    business_id: employeeId,
    primary_branch_id: employeeId,
    name_en: 'Synthetic employee',
    name_ar: null,
    role_code: 'staff' as const,
    hire_date: '2026-01-01',
    contract_end: null,
    user_id: null,
    created_at: '2026-10-03T00:00:00.000Z',
    employee_number: 15,
    revision: 3,
    branch_ids: [employeeId],
    ...overrides,
  };
}

export const missing = {
  error: { code: 'NOT_FOUND', message_en: 'Synthetic missing', message_ar: 'Synthetic missing' },
  response: { status: 404 },
};
