import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeNumberEdit } from './employee-number-edit';

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, PUT: put }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const first = '01920000-0000-7000-8000-0000000000a2';
const second = '01920000-0000-7000-8000-0000000000b2';
const editName = () => t('en', 'staff.editNumber');

function renderEdits() {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <div data-testid="refused-employee">
        <EmployeeNumberEdit
          companyId={first}
          businessId={first}
          userId={first}
          employeeId={first}
          primaryBranchId={first}
          employeeNumber={15}
        />
      </div>
      <div data-testid="other-employee">
        <EmployeeNumberEdit
          companyId={first}
          businessId={first}
          userId={first}
          employeeId={second}
          primaryBranchId={first}
          employeeNumber={4}
        />
      </div>
    </QueryClientProvider>,
  );
  return query;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  });
  get.mockResolvedValue({ data: { can_type_number: true } });
  put.mockResolvedValue({
    error: {
      code: 'FORBIDDEN',
      message_en: 'Synthetic refusal',
      message_ar: t('ar', 'errors.FORBIDDEN'),
    },
  });
});

it('hides edit for the refused employee after close and keeps it for another', async () => {
  renderEdits();
  const refused = () => within(screen.getByTestId('refused-employee'));
  const other = () => within(screen.getByTestId('other-employee'));
  fireEvent.click(await refused().findByRole('button', { name: editName() }));
  expect(other().getByRole('button', { name: editName() })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic refusal');
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(refused().queryByRole('button', { name: editName() })).toBeNull();
  });
  expect(other().getByRole('button', { name: editName() })).toBeTruthy();
});

it('shows edit again when the employee detail attachments change', async () => {
  const query = renderEdits();
  const detailKey = ['employees', first, first, first, 'detail', first] as const;
  query.setQueryData(detailKey, {
    employee_number: 15,
    primary_branch_id: first,
    branch_ids: [first],
  });
  const refused = () => within(screen.getByTestId('refused-employee'));
  fireEvent.click(await refused().findByRole('button', { name: editName() }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  await waitFor(() => expect(refused().queryByRole('button', { name: editName() })).toBeNull());
  const pinnedAt = Date.now() + 1_000;
  query.setQueryData(
    detailKey,
    { employee_number: 15, primary_branch_id: first, branch_ids: [first] },
    { updatedAt: pinnedAt },
  );
  expect(refused().queryByRole('button', { name: editName() })).toBeNull();
  query.setQueryData(
    detailKey,
    { employee_number: 15, primary_branch_id: first, branch_ids: [first, second] },
    { updatedAt: pinnedAt + 1_000 },
  );
  expect(await refused().findByRole('button', { name: editName() })).toBeTruthy();
});

it('keeps edit for another user when this user was refused', async () => {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <div data-testid="user-a">
        <EmployeeNumberEdit
          companyId={first}
          businessId={first}
          userId={first}
          employeeId={first}
          primaryBranchId={first}
          employeeNumber={15}
        />
      </div>
      <div data-testid="user-b">
        <EmployeeNumberEdit
          companyId={first}
          businessId={first}
          userId={second}
          employeeId={first}
          primaryBranchId={first}
          employeeNumber={15}
        />
      </div>
    </QueryClientProvider>,
  );
  const userA = () => within(screen.getByTestId('user-a'));
  const userB = () => within(screen.getByTestId('user-b'));
  fireEvent.click(await userA().findByRole('button', { name: editName() }));
  expect(userB().getByRole('button', { name: editName() })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  await waitFor(() => expect(userA().queryByRole('button', { name: editName() })).toBeNull());
  expect(userB().getByRole('button', { name: editName() })).toBeTruthy();
});

it('keeps the refused edit hidden after the default cache time', async () => {
  vi.useFakeTimers();
  try {
    const refused = () => within(screen.getByTestId('refused-employee'));
    renderEdits();
    await act(() => vi.advanceTimersByTimeAsync(1));
    fireEvent.click(refused().getByRole('button', { name: editName() }));
    fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('alert').textContent).toBe('Synthetic refusal');
    fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(refused().queryByRole('button', { name: editName() })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1));
    expect(refused().queryByRole('button', { name: editName() })).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

type DetailSnapshot = {
  employee_number: number;
  primary_branch_id: string;
  branch_ids: readonly string[];
};

function StaleDetail({ snapshot }: { snapshot: () => DetailSnapshot | Promise<DetailSnapshot> }) {
  useQuery({
    queryKey: ['employees', first, first, first, 'detail', first],
    retry: false,
    queryFn: () => snapshot(),
  });
  return null;
}

function heldBranchRefetch() {
  let reads = 0;
  let release: () => void = () => undefined;
  const snapshot = (): DetailSnapshot | Promise<DetailSnapshot> => {
    reads += 1;
    if (reads === 1) {
      return { employee_number: 15, primary_branch_id: first, branch_ids: [first] };
    }
    return new Promise((resolve) => {
      release = () =>
        resolve({
          employee_number: 15,
          primary_branch_id: first,
          branch_ids: [first, second],
        });
    });
  };
  return { snapshot, reads: () => reads, release: () => release() };
}

function renderProfile(
  query: QueryClient,
  snapshot: () => DetailSnapshot | Promise<DetailSnapshot>,
) {
  return render(
    <QueryClientProvider client={query}>
      <StaleDetail snapshot={snapshot} />
      <EmployeeNumberEdit
        companyId={first}
        businessId={first}
        userId={first}
        employeeId={first}
        primaryBranchId={first}
        employeeNumber={15}
      />
    </QueryClientProvider>,
  );
}

it('keeps edit hidden when a stale detail refetch returns new branches', async () => {
  let reads = 0;
  const snapshot = () => {
    reads += 1;
    const branch_ids = reads === 1 ? [first] : [first, second];
    return { employee_number: 15, primary_branch_id: first, branch_ids };
  };
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <StaleDetail snapshot={snapshot} />
      <EmployeeNumberEdit
        companyId={first}
        businessId={first}
        userId={first}
        employeeId={first}
        primaryBranchId={first}
        employeeNumber={15}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(reads).toBe(1));
  fireEvent.click(await screen.findByRole('button', { name: editName() }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  await screen.findByRole('alert');
  await waitFor(() => {
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(query.getQueryData(['employees', first, first, first, 'detail', first])).toMatchObject({
      branch_ids: [first, second],
    });
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: editName() })).toBeNull();
  });
});

it('pins a remounted refusal only to detail fetched after the refusal', async () => {
  const held = heldBranchRefetch();
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const refusalKey = ['employee-number-edit-refused', first, first, first] as const;
  const mark = () => query.getQueryData<{ branch_ids: readonly string[] | null }>(refusalKey);
  const view = renderProfile(query, held.snapshot);
  await waitFor(() => expect(held.reads()).toBe(1));
  fireEvent.click(await screen.findByRole('button', { name: editName() }));
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  await screen.findByRole('alert');
  await waitFor(() => expect(held.reads()).toBeGreaterThanOrEqual(2));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  view.unmount();
  renderProfile(query, held.snapshot);
  await act(async () => undefined);
  expect(mark()?.branch_ids).toBeNull();
  expect(screen.queryByRole('button', { name: editName() })).toBeNull();
  held.release();
  await waitFor(() => expect(mark()?.branch_ids).toEqual([first, second]));
  expect(screen.queryByRole('button', { name: editName() })).toBeNull();
});
