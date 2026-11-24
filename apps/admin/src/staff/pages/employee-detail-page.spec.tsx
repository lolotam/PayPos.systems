import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EmployeeDetailTab } from '../model/employee-detail-tabs';
import { EmployeeDetailPage } from './employee-detail-page';
import {
  DETAIL_PATH,
  business,
  businessWithTokyoFirst,
  detail,
  employeeId,
  missing,
} from './employee-detail-page.fixture';

// الأقسام السبعة مُحاكاة هنا بعلامات نصية لأن كل قسم يخفي نفسه عند رفض قراءته (الدوام والبطاقة مثلًا)،
// فلا يُرى تركيب التبويب إلا بعلامة؛ وسلوك كل قسم له مواصفاته، و`employee-detail-requests.spec.tsx`
// يشغّل الأقسام الحقيقية ويثبت قراءاتها.
const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
const seen = vi.hoisted(() => ({ access: vi.fn(), iban: vi.fn(), leave: vi.fn(), salary: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: api.get, PATCH: api.patch }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }) }));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({
    mutateAsync: () => Promise.resolve({ visible_total: 0, hidden_exists: false }),
  }),
}));
vi.mock('../ui/employee-number-edit', () => ({ EmployeeNumberEdit: () => null }));
vi.mock('../ui/employee-access-section', () => ({
  EmployeeAccessSection: (props: object) => {
    seen.access(props);
    return <p>access section</p>;
  },
}));
vi.mock('../ui/employee-salary-section', () => ({
  EmployeeSalarySection: (props: object) => {
    seen.salary(props);
    return <p>salary section</p>;
  },
}));
vi.mock('../ui/employee-iban-section', () => ({
  EmployeeIbanSection: (props: { timeZone: string }) => {
    seen.iban(props);
    return <p>iban section {props.timeZone}</p>;
  },
}));
vi.mock('../ui/employee-default-hours-section', () => ({
  EmployeeDefaultHoursSection: () => <p>default hours section</p>,
}));
vi.mock('../ui/employee-card-section', () => ({ EmployeeCardSection: () => <p>card section</p> }));
vi.mock('../ui/employee-documents-section', () => ({
  EmployeeDocumentsSection: () => <p>documents section</p>,
}));
vi.mock('../ui/employee-leave-section', () => ({
  EmployeeLeaveSection: (props: { timeZone?: string }) => {
    seen.leave(props);
    return <p>leave section {String(props.timeZone)}</p>;
  },
}));

const SECTIONS = [
  'salary section',
  'iban section',
  'default hours section',
  'card section',
  'documents section',
  'leave section',
  'access section',
] as const;
const label = (key: Parameters<typeof t>[1]) => t('en', key);
const tabsNav = () => screen.getByRole('navigation', { name: label('leaveHistory.tabsLabel') });
const shown = () =>
  SECTIONS.filter((name) => screen.queryByText(new RegExp(`^${name}`)) !== null);
const detailReads = () => api.get.mock.calls.filter(([path]) => path === DETAIL_PATH).length;
let client: QueryClient;

/** يغيّر الاسم ويكتب تاريخ تغيير الفروع الذي يطلبه النموذج دائمًا، ثم يضغط حفظ. */
async function saveRenamed() {
  fireEvent.change(await screen.findByLabelText(label('staff.nameEn')), {
    target: { value: 'Renamed employee' },
  });
  fireEvent.change(screen.getByLabelText(label('staff.effectiveDate')), {
    target: { value: '2026-10-04' },
  });
  fireEvent.click(screen.getByRole('button', { name: label('staff.save') }));
}

function page(tab: EmployeeDetailTab, shownBusiness = business) {
  return (
    <QueryClientProvider client={client}>
      <EmployeeDetailPage
        companyId={employeeId}
        business={shownBusiness}
        userId={employeeId}
        employeeId={employeeId}
        tab={tab}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path === DETAIL_PATH ? { data: detail() } : missing),
  );
  api.patch.mockImplementation((_path: string, init: { body: { name_en: string } }) =>
    Promise.resolve({ data: detail({ name_en: init.body.name_en, revision: 4 }) }),
  );
});

it('opens on Details: header, five tabs with Details current, the form and staff access only', async () => {
  render(page('data'));
  expect(await screen.findByLabelText(label('staff.nameEn'))).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1, name: label('staff.editTitle') })).toBeTruthy();
  expect(screen.getByText('Synthetic employee').parentElement?.textContent).toContain('15');
  const tabs = within(tabsNav()).getAllByRole('link');
  expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('href')])).toEqual([
    [label('leaveHistory.tabData'), `/staff/${employeeId}`],
    [label('leaveHistory.tabPay'), `/staff/${employeeId}?tab=pay`],
    [label('leaveHistory.tabHours'), `/staff/${employeeId}?tab=hours`],
    [label('leaveHistory.tabDocuments'), `/staff/${employeeId}?tab=documents`],
    [label('leaveHistory.tabLeave'), `/staff/${employeeId}/leave`],
  ]);
  expect(tabs.map((tab) => tab.getAttribute('aria-current'))).toEqual(['page', ...Array(4).fill(null)]);
  expect(shown()).toEqual(['access section']);
  expect(seen.access).toHaveBeenLastCalledWith({
    companyId: employeeId,
    businessId: employeeId,
    employeeId,
  });
});

it('shows the employee number beside the name, with its label for screen readers only', async () => {
  render(page('data'));
  await screen.findByText('Synthetic employee');
  const numberLabel = screen.getByText(label('staff.employeeNumber'), { exact: false });
  expect(numberLabel.className).toContain('sr-only');
  expect(numberLabel.parentElement?.textContent).toBe(`${label('staff.employeeNumber')} 15`);
});

it.each([
  ['pay', ['salary section', 'iban section']],
  ['hours', ['default hours section', 'card section']],
  ['documents', ['documents section']],
  ['leave', ['leave section']],
] as const)('%s shows its tab current and exactly its sections', async (tab, sections) => {
  render(page(tab));
  await waitFor(() => expect(shown()).toEqual([...sections]));
  expect(screen.queryByLabelText(label('staff.nameEn'))).toBeNull();
  const current = within(tabsNav())
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page');
  expect(current.map((link) => link.getAttribute('href'))).toEqual([
    tab === 'leave' ? `/staff/${employeeId}/leave` : `/staff/${employeeId}?tab=${tab}`,
  ]);
});

it("gives the IBAN and Leave sections the employee's primary branch zone, and UTC when it is unknown", async () => {
  const view = render(page('pay', businessWithTokyoFirst));
  expect(await screen.findByText('iban section Asia/Kuwait')).toBeTruthy();
  expect(seen.salary).toHaveBeenLastCalledWith(
    expect.objectContaining({ companyId: employeeId, businessId: employeeId, userId: employeeId, employeeId }),
  );
  view.unmount();
  client.clear();
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path === DETAIL_PATH ? { data: detail({ primary_branch_id: employeeId.replace(/2$/, '9') }) } : missing),
  );
  render(page('pay'));
  expect(await screen.findByText('iban section UTC')).toBeTruthy();
});

it('waits for the employee record before mounting Leave, then uses its primary zone', async () => {
  let release: (value: { data: ReturnType<typeof detail> }) => void = () => undefined;
  api.get.mockImplementation((path: string) =>
    path === DETAIL_PATH
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve(missing),
  );
  render(page('leave', businessWithTokyoFirst));
  expect(screen.getByRole('status').textContent).toBe(label('admin.loading'));
  expect(shown()).toEqual([]);
  release({ data: detail() });
  expect(await screen.findByText('leave section Asia/Kuwait')).toBeTruthy();
  expect(screen.queryByText(/Asia\/Tokyo/)).toBeNull();
});

it('saves the form, shows the saved message and the refreshed values', async () => {
  render(page('data'));
  await saveRenamed();
  expect((await screen.findByRole('status')).textContent).toBe(label('staff.saved'));
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText(label('staff.nameEn')) as HTMLInputElement).value).toBe(
    'Renamed employee',
  );
  expect(screen.getByText('Renamed employee', { selector: 'span' })).toBeTruthy();
});

it('shows the save error as an alert and keeps the typed values', async () => {
  api.patch.mockResolvedValue({
    error: { code: 'REVISION_CONFLICT', message_en: 'Synthetic conflict', message_ar: 'Synthetic conflict' },
  });
  render(page('data'));
  await saveRenamed();
  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic conflict');
  expect(screen.queryByText(label('staff.saved'))).toBeNull();
  expect((screen.getByLabelText(label('staff.nameEn')) as HTMLInputElement).value).toBe(
    'Renamed employee',
  );
});

it('reload clears the save message and reads the employee again', async () => {
  render(page('data'));
  await saveRenamed();
  await screen.findByText(label('staff.saved'));
  const reload = screen.getByRole('button', { name: label('staff.reload') });
  await waitFor(() => expect((reload as HTMLButtonElement).disabled).toBe(false));
  const before = detailReads();
  fireEvent.click(reload);
  await waitFor(() => expect(detailReads()).toBe(before + 1));
  expect(screen.queryByText(label('staff.saved'))).toBeNull();
});

it.each(['data', 'pay', 'hours', 'documents'] as const)(
  'a failed employee read on %s shows the error inside the shell with the back link',
  async (tab) => {
    api.get.mockResolvedValue(missing);
    render(page(tab));
    expect((await screen.findByRole('alert')).textContent).toBe('Synthetic missing');
    expect(shown()).toEqual([]);
    expect(screen.queryByLabelText(label('staff.nameEn'))).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: label('staff.editTitle') })).toBeTruthy();
    expect(screen.getByRole('link', { name: label('staff.cancel') }).getAttribute('href')).toBe('/staff');
    expect(within(tabsNav()).getAllByRole('link')).toHaveLength(5);
  },
);

it('mounts the Leave section with an undefined zone fallback when the employee record read fails', async () => {
  api.get.mockResolvedValue(missing);
  render(page('leave'));
  expect(await screen.findByText('leave section undefined')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('link', { name: label('staff.cancel') }).getAttribute('href')).toBe('/staff');
});

it.each(['data', 'leave'] as const)('keeps Reload and the back link on %s', async (tab) => {
  render(page(tab));
  await waitFor(() => expect(detailReads()).toBe(1));
  expect(screen.getByRole('button', { name: label('staff.reload') })).toBeTruthy();
  expect(screen.getByRole('link', { name: label('staff.cancel') }).getAttribute('href')).toBe('/staff');
});

it('discards unsaved Details edits when another tab is opened and Details is opened again', async () => {
  const view = render(page('data'));
  fireEvent.change(await screen.findByLabelText(label('staff.nameEn')), {
    target: { value: 'Unsaved name' },
  });
  view.rerender(page('pay'));
  expect(screen.queryByLabelText(label('staff.nameEn'))).toBeNull();
  view.rerender(page('data'));
  expect((await screen.findByLabelText(label('staff.nameEn')) as HTMLInputElement).value).toBe(
    'Synthetic employee',
  );
});

it('moves between tabs without reloading the page, but leaves modified clicks to the browser', async () => {
  const block = (event: Event) => event.preventDefault();
  document.addEventListener('click', block);
  try {
    render(page('data'));
    await screen.findByLabelText(label('staff.nameEn'));
    const pay = screen.getByRole('link', { name: label('leaveHistory.tabPay') });
    fireEvent.click(pay, { ctrlKey: true });
    expect(nav.push).not.toHaveBeenCalled();
    fireEvent.click(pay);
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith(`/staff/${employeeId}?tab=pay`);
  } finally {
    document.removeEventListener('click', block);
  }
});
