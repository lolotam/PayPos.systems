import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAccessGrantForm } from './employee-access-grant-form';

// فروع زيادة واستثناء صلاحية مضمّن في «إعطاء الدخول» (080-b): الشاشة بتختارهم وبتطلعهم في
// نفس الطلب، والنتيجة الظاهرة بعد الالتزام هي حالة الدخول الممنوحة.
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const COMPANY = '01920000-0000-7000-8000-00000000000a';
const BUSINESS = '01920000-0000-7000-8000-00000000000b';
const EMPLOYEE = '01920000-0000-7000-8000-00000000000d';
const PRIMARY = '01920000-0000-7000-8000-000000000001';
const EXTRA = '01920000-0000-7000-8000-000000000002';

const BRANCHES = [
  { id: PRIMARY, name_en: 'Salmiya', name_ar: null },
  { id: EXTRA, name_en: 'Hawalli', name_ar: null },
];

const ACTIVE = {
  state: 'ACTIVE',
  role: 'staff',
  branch_id: PRIMARY,
  phone_last3: '567',
  can_manage: true,
  can_cancel: false,
};

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EmployeeAccessGrantForm
        companyId={COMPANY}
        businessId={BUSINESS}
        employeeId={EMPLOYEE}
        primaryBranchId={PRIMARY}
        branches={BRANCHES}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function fillBasics() {
  fireEvent.change(screen.getByLabelText('Her phone (canonical, with country code)'), {
    target: { value: '+96551234567' },
  });
  fireEvent.change(screen.getByLabelText('Temporary PIN (4 digits)'), {
    target: { value: '1234' },
  });
  fireEvent.click(screen.getByLabelText('I confirmed this number is hers'));
}

/** يختار فرع زيادة ودوره ويضيفه للقائمة. */
function addExtraBranch(role = 'staff') {
  fireEvent.change(screen.getByLabelText('Extra branch'), { target: { value: EXTRA } });
  fireEvent.change(screen.getByLabelText('Extra branch role'), { target: { value: role } });
  fireEvent.click(screen.getByRole('button', { name: 'Add a branch' }));
}

/** يختار استثناء صلاحية على فرع زيادة ويضيفه للقائمة. */
function addOverride() {
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.overridePermissionLabel')), {
    target: { value: 'create:customers:branch' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideScopeTypeLabel')), {
    target: { value: 'BRANCH' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideScopeIdLabel')), {
    target: { value: EXTRA },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideReasonLabel')), {
    target: { value: 'covering the front desk' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.addOverride') }));
}

const sentBody = () => post.mock.calls[0]?.[1]?.body as Record<string, unknown>;

const EXPECTED_OVERRIDE = {
  permission_code: 'create:customers:branch',
  effect: 'ALLOW',
  scope_type: 'BRANCH',
  scope_id: EXTRA,
  reason: 'covering the front desk',
  expires_at: null,
};

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: ACTIVE, error: undefined });
});

describe('the multi-branch grant on the employee access form', () => {
  it('keeps the primary branch out of the extra-branch list', () => {
    renderForm();
    fillBasics();
    const options = Array.from(
      screen.getByLabelText('Extra branch').querySelectorAll('option'),
    ).map((option) => option.value);
    expect(options).toEqual(['', EXTRA]);
  });

  it('adds an extra branch with its role and sends it with the grant', async () => {
    renderForm();
    fillBasics();
    addExtraBranch('reception');
    expect(screen.getByRole('button', { name: 'Remove the branch' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(sentBody()['additional_branches']).toEqual([
      { branch_id: EXTRA, role: 'reception' },
    ]);
    expect(await screen.findByText(/Access granted/)).toBeTruthy();
  });

  it('removes an added extra branch before the grant goes out', async () => {
    renderForm();
    fillBasics();
    addExtraBranch();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the branch' }));
    expect(screen.queryByRole('button', { name: 'Remove the branch' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(sentBody()['additional_branches']).toBeUndefined();
    expect(await screen.findByText(/Access granted/)).toBeTruthy();
  });

  it('adds an inline permission exception and sends it with the grant', async () => {
    renderForm();
    fillBasics();
    addOverride();
    expect(screen.getByRole('button', { name: t('en', 'invitations.removeOverride') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(sentBody()['permission_overrides']).toEqual([EXPECTED_OVERRIDE]);
    expect(await screen.findByText(/Access granted/)).toBeTruthy();
  });

  it('sends no extra branch and no exception when the manager picks none', async () => {
    renderForm();
    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(sentBody()['additional_branches']).toBeUndefined();
    expect(sentBody()['permission_overrides']).toBeUndefined();
    expect(await screen.findByText(/Access granted/)).toBeTruthy();
  });
});
