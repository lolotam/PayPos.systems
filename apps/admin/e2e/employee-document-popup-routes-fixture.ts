import type { IncomingMessage } from 'node:http';
import { t } from '@pospay/i18n';

export const CIVIL = 'synthetic/civil';
export const PASSPORT = 'synthetic/passport';
export const KEYS = [CIVIL, PASSPORT];
const USER = '83000000-0000-4000-8000-000000000001';
export const FIRST = '83000000-0000-4000-8000-000000000013';
const SECOND = '83000000-0000-4000-8000-000000000023';
const A = '83000000-0000-4000-8000-000000000010';
const AB = '83000000-0000-4000-8000-000000000011';
const ABR = '83000000-0000-4000-8000-000000000012';
const B = '83000000-0000-4000-8000-000000000020';
const BB = '83000000-0000-4000-8000-000000000021';
const BBR = '83000000-0000-4000-8000-000000000022';
type Tenant = { company: string; business: string; branch: string; employees: string[] };
const TENANTS: Tenant[] = [
  { company: A, business: AB, branch: ABR, employees: [FIRST, SECOND] },
  { company: B, business: BB, branch: BBR, employees: [FIRST] },
];
type Kind =
  'session' | 'workspaces' | 'count' | 'employees' | 'detail' | 'documents' | 'download' | 'denied';
type Route = {
  kind: Kind;
  method: string;
  path: string;
  query: Record<string, string>;
  tenant?: Tenant;
};
const EMPLOYEE_DENIALS: [string, Record<string, string>][] = [
  ['/employee-number-capability', {}],
  ['/salaries', { limit: '20' }],
  ['/iban', {}],
  ['/default-shifts', {}],
  ['/cards', {}],
  ['/leave-requests', { limit: '20' }],
];
const BUSINESS_DENIALS = [
  '/alert-rules',
  '/rating-settings',
  '/settings/identity-capability',
  '/settings/staff-columns',
];
export function failure(status: number, message_en = 'Synthetic unrelated refusal') {
  const denied = status === 403;
  return {
    code: denied ? 'FORBIDDEN' : 'NOT_FOUND',
    message_ar: t('ar', denied ? 'errors.FORBIDDEN' : 'errors.NOT_FOUND'),
    message_en,
  };
}
export function expectQuery(url: URL, expected: Record<string, string>) {
  const actual = [...url.searchParams.entries()];
  const entries = Object.entries(expected);
  if (
    actual.length !== entries.length ||
    actual.some(
      ([key, value], index) => key !== entries[index]?.[0] || value !== entries[index]?.[1],
    )
  )
    throw new Error('unexpected query');
}
export function tenantFor(req: IncomingMessage) {
  const tenant = TENANTS.find((candidate) => candidate.company === req.headers['x-company-id']);
  if (!tenant) throw new Error('unexpected company');
  return tenant;
}
function employee(id: string, tenant: Tenant) {
  return {
    id,
    business_id: tenant.business,
    primary_branch_id: tenant.branch,
    name_en: id === FIRST ? 'Synthetic employee A' : 'Synthetic employee B',
    name_ar: null,
    role_code: 'staff',
    hire_date: '2026-01-01',
    contract_end: null,
    user_id: null,
    created_at: '2026-01-01T00:00:00Z',
    employee_number: id === FIRST ? 1 : 2,
  };
}
export function workspaces() {
  return {
    companies: TENANTS.map((tenant, index) => ({
      id: tenant.company,
      name_en: `Synthetic company ${index === 0 ? 'A' : 'B'}`,
      name_ar: null,
      role_code: 'owner',
      scope: 'COMPANY',
      businesses: [
        {
          id: tenant.business,
          name_en: `Synthetic business ${index + 1}`,
          name_ar: null,
          branches: [
            {
              id: tenant.branch,
              name_en: `Synthetic branch ${index + 1}`,
              name_ar: null,
              effective_timezone: 'Asia/Kuwait',
              is_active: true,
            },
          ],
        },
      ],
    })),
  };
}
export function documents(employeeId: string, omit: string) {
  const item = (key: string) => ({
    id: key === CIVIL ? FIRST : SECOND,
    employee_id: employeeId,
    type_code: key === CIVIL ? 'civil_id' : 'passport',
    type_name_en: key === CIVIL ? 'Civil ID' : 'Passport',
    type_name_ar: null,
    object_key: key,
    expires_on: null,
    uploaded_by: USER,
    recorded_at: '2026-01-01T00:00:00Z',
    status: 'NO_EXPIRY',
  });
  return {
    today: '2026-01-02',
    types: [],
    can_manage: false,
    items: KEYS.filter((key) => key !== omit).map(item),
  };
}
export function sessionPayload() {
  return {
    session: { id: USER, userId: USER, expiresAt: '2026-12-01T00:00:00Z' },
    user: { id: USER, name: 'Synthetic popup fixture', email: 'popup830@example.invalid' },
  };
}
export function employeesPayload(tenant: Tenant) {
  return { next_cursor: null, items: tenant.employees.map((id) => employee(id, tenant)) };
}
export function detailPayload(id: string, tenant: Tenant) {
  return { ...employee(id, tenant), revision: 1, branch_ids: [tenant.branch] };
}
function routeOf(
  kind: Kind,
  path: string,
  tenant?: Tenant,
  query: Record<string, string> = {},
): Route {
  const method = kind === 'download' ? 'POST' : 'GET';
  return tenant === undefined
    ? { kind, method, path, query }
    : { kind, method, path, query, tenant };
}
function inventory(): Route[] {
  const fixed = [
    routeOf('session', '/v1/auth/get-session'),
    routeOf('workspaces', '/v1/me/workspaces'),
    routeOf('count', '/v1/me/notifications/unread-count'),
    routeOf('download', '/v1/files/download'),
    routeOf('denied', '/v1/employee-numbering'),
  ];
  return [
    ...fixed,
    ...TENANTS.flatMap((tenant) => {
      const root = `/v1/businesses/${tenant.business}`;
      const employees = `${root}/employees`;
      return [
        routeOf('employees', employees, tenant, { limit: '20' }),
        routeOf('denied', `${root}/employee-passkeys`, tenant, { limit: '20' }),
        routeOf('denied', `${root}/staff/employee-app-link`, tenant),
        routeOf('denied', `${root}/leave-history`, tenant, {
          from: '2000-01-01',
          to: '2000-01-01',
          limit: '1',
        }),
        ...BUSINESS_DENIALS.map((suffix) => routeOf('denied', `${root}${suffix}`, tenant)),
        ...tenant.employees.flatMap((employeeId) => [
          routeOf('detail', `${employees}/${employeeId}`, tenant),
          routeOf('documents', `${employees}/${employeeId}/documents`, tenant),
          ...EMPLOYEE_DENIALS.map(([suffix, query]) =>
            routeOf('denied', `${employees}/${employeeId}${suffix}`, tenant, query),
          ),
        ]),
      ];
    }),
  ];
}
const ROUTES = inventory();
export function matchRoute(method: string, path: string, url: URL) {
  const matched = ROUTES.find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  if (!matched) throw new Error('unknown route');
  expectQuery(url, matched.query);
  return matched;
}
