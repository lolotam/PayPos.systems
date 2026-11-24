import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EmployeeDetailTab } from '../model/employee-detail-tabs';
import { EmployeeDetailPage } from './employee-detail-page';
import { DETAIL_PATH, business, detail, employeeId, missing } from './employee-detail-page.fixture';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: api.get, POST: api.get, PUT: api.get, PATCH: api.get }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const EMPLOYEE = '/v1/businesses/{businessId}/employees/{employeeId}';
const READS = {
  access: `${EMPLOYEE}/staff-access`,
  numberCapability: `${EMPLOYEE}/employee-number-capability`,
  salaries: `${EMPLOYEE}/salaries`,
  iban: `${EMPLOYEE}/iban`,
  hours: `${EMPLOYEE}/default-shifts`,
  cards: `${EMPLOYEE}/cards`,
  documents: `${EMPLOYEE}/documents`,
  leave: `${EMPLOYEE}/leave-requests`,
} as const;
const requested = () => new Set(api.get.mock.calls.map(([path]) => path as string));

function open(tab: EmployeeDetailTab) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeDetailPage
        companyId={employeeId}
        business={business}
        userId={employeeId}
        employeeId={employeeId}
        tab={tab}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path === DETAIL_PATH ? { data: detail() } : missing),
  );
});

it.each([
  ['data', [READS.access, READS.numberCapability]],
  ['pay', [READS.salaries, READS.iban]],
  ['hours', [READS.hours, READS.cards]],
  ['documents', [READS.documents]],
  ['leave', [READS.leave]],
] as const)('opening %s requests only its own reads', async (tab, own) => {
  open(tab);
  await screen.findByRole('heading', { level: 1, name: t('en', 'staff.editTitle') });
  await waitFor(() => {
    for (const path of own) expect(requested().has(path)).toBe(true);
  });
  expect(requested().has(DETAIL_PATH)).toBe(true);
  const others = Object.values(READS).filter((path) => !(own as readonly string[]).includes(path));
  // رقم الموظف يُقرأ من الترويسة على كل تبويب، فلا يُعدّ من قراءات التبويب الآخر.
  const foreign = others.filter((path) => path !== READS.numberCapability);
  expect(foreign.filter((path) => requested().has(path))).toEqual([]);
});
