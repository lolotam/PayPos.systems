import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { employeeNumberEditCapabilityKey } from '../api/use-employee-number-edit-capability';
import { EmployeeNumberEdit } from './employee-number-edit';

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ canEdit: true, reads: 0 }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, PUT: put }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const first = '01920000-0000-7000-8000-0000000000a2';
const second = '01920000-0000-7000-8000-0000000000b2';
const editName = () => t('en', 'staff.editNumber');
const editPath = '/v1/businesses/{businessId}/employees/{employeeId}/employee-number-capability';
const forbidden = {
  code: 'FORBIDDEN',
  message_en: 'Synthetic refusal',
  message_ar: t('ar', 'errors.FORBIDDEN'),
};

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function installDialog() {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  });
}

function renderEdit(props: { userId: string; employeeId: string }, testId: string) {
  return (
    <div data-testid={testId}>
      <EmployeeNumberEdit
        companyId={first}
        businessId={first}
        userId={props.userId}
        employeeId={props.employeeId}
        employeeNumber={15}
      />
    </div>
  );
}

beforeEach(() => {
  installDialog();
  state.canEdit = true;
  state.reads = 0;
  get.mockImplementation((path: string) => {
    if (path === editPath) {
      state.reads += 1;
      return Promise.resolve({ data: { can_edit_number: state.canEdit } });
    }
    return Promise.resolve({
      error: { message_en: 'Synthetic missing', message_ar: 'Synthetic missing' },
      response: { status: 404 },
    });
  });
  put.mockResolvedValue({ error: forbidden });
});

it('shows the edit action when the capability allows it', async () => {
  const query = client();
  render(
    <QueryClientProvider client={query}>
      {renderEdit({ userId: first, employeeId: first }, 'allowed')}
    </QueryClientProvider>,
  );
  expect(
    await within(screen.getByTestId('allowed')).findByRole('button', { name: editName() }),
  ).toBeTruthy();
});

it('hides the edit action when the capability is false', async () => {
  state.canEdit = false;
  const query = client();
  render(
    <QueryClientProvider client={query}>
      {renderEdit({ userId: first, employeeId: first }, 'denied')}
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(query.getQueryData(employeeNumberEditCapabilityKey(first, first, first, first))).toEqual(
      {
        can_edit_number: false,
      },
    );
  });
  expect(screen.queryByRole('button', { name: editName() })).toBeNull();
});

it('refetches the capability after a forbidden save and hides the action after close', async () => {
  const query = client();
  render(
    <QueryClientProvider client={query}>
      {renderEdit({ userId: first, employeeId: first }, 'refused')}
    </QueryClientProvider>,
  );
  const refused = () => within(screen.getByTestId('refused'));
  fireEvent.click(await refused().findByRole('button', { name: editName() }));
  const readsAtOpen = state.reads;
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  state.canEdit = false;
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic refusal');
  await waitFor(() => {
    expect(state.reads).toBeGreaterThan(readsAtOpen);
    expect(query.getQueryData(employeeNumberEditCapabilityKey(first, first, first, first))).toEqual(
      {
        can_edit_number: false,
      },
    );
  });
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(refused().queryByRole('button', { name: editName() })).toBeNull();
  });
});

it('leaves another user able to edit after this user is refused', async () => {
  const query = client();
  render(
    <QueryClientProvider client={query}>
      {renderEdit({ userId: first, employeeId: first }, 'user-a')}
      {renderEdit({ userId: second, employeeId: first }, 'user-b')}
    </QueryClientProvider>,
  );
  const userA = () => within(screen.getByTestId('user-a'));
  const userB = () => within(screen.getByTestId('user-b'));
  fireEvent.click(await userA().findByRole('button', { name: editName() }));
  expect(userB().getByRole('button', { name: editName() })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'staff.employeeNumber')), {
    target: { value: '8' },
  });
  state.canEdit = false;
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.saveNumber') }));
  await screen.findByRole('alert');
  const otherKey = employeeNumberEditCapabilityKey(first, second, first, first);
  await waitFor(() => {
    expect(query.getQueryData(employeeNumberEditCapabilityKey(first, first, first, first))).toEqual(
      {
        can_edit_number: false,
      },
    );
  });
  expect(query.getQueryState(otherKey)?.isInvalidated).not.toBe(true);
  expect(query.getQueryData(otherKey)).toEqual({ can_edit_number: true });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.closeNumber') }));
  await waitFor(() => expect(userA().queryByRole('button', { name: editName() })).toBeNull());
  expect(userB().getByRole('button', { name: editName() })).toBeTruthy();
});
