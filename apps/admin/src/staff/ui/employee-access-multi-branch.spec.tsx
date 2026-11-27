import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { permissionModuleName, t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAccessGrantForm } from './employee-access-grant-form';

// فروع زيادة واستثناء صلاحية مضمّن في «إعطاء الدخول» (080-b): الشاشة بتختارهم وبتطلعهم في
// نفس الطلب، والنتيجة الظاهرة بعد الالتزام هي حالة الدخول الممنوحة.
const post = vi.hoisted(() => vi.fn());
const localeState = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => localeState.locale }));

const COMPANY = '01920000-0000-7000-8000-00000000000a';
const BUSINESS = '01920000-0000-7000-8000-00000000000b';
const EMPLOYEE = '01920000-0000-7000-8000-00000000000d';
const PRIMARY = '01920000-0000-7000-8000-000000000001';
const EXTRA = '01920000-0000-7000-8000-000000000002';
const ARCHIVED = '01920000-0000-7000-8000-000000000003';

const BRANCHES = [
  { id: PRIMARY, name_en: 'Salmiya', name_ar: null, is_active: true },
  { id: EXTRA, name_en: 'Hawalli', name_ar: null, is_active: true },
  { id: ARCHIVED, name_en: 'Archived branch', name_ar: null, is_active: false },
];

// 21 فرع زيادة: الحد 20 في العقد، فاختبار السقف محتاج أكثر من الحد.
const CAP_BRANCHES = Array.from({ length: 21 }, (_, index) => ({
  id: `01920000-0000-7000-8000-${String(index + 10).padStart(12, '0')}`,
  name_en: `Branch ${index + 10}`,
  name_ar: null,
  is_active: true,
}));

const ACTIVE = {
  state: 'ACTIVE',
  role: 'staff',
  branch_id: PRIMARY,
  phone_last3: '567',
  can_manage: true,
  can_cancel: false,
};

function renderForm(branches: readonly (typeof BRANCHES)[number][] = BRANCHES) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EmployeeAccessGrantForm
        companyId={COMPANY}
        businessId={BUSINESS}
        employeeId={EMPLOYEE}
        primaryBranchId={PRIMARY}
        branches={branches}
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
  localeState.locale = 'en';
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

  it('keeps an archived branch and an already chosen branch out of the list', () => {
    renderForm();
    fillBasics();
    const picker = () => screen.getByLabelText('Extra branch') as HTMLSelectElement;
    expect(Array.from(picker().querySelectorAll('option')).map((option) => option.value)).toEqual([
      '',
      EXTRA,
    ]);
    addExtraBranch();
    // الفرع المضاف ما بيتردش تاني، والفرع المؤرشف ما بيظهرش أصلاً.
    expect(Array.from(picker().querySelectorAll('option')).map((option) => option.value)).toEqual([
      '',
    ]);
    // والصف المضاف لسه بيعرض اسم الفرع.
    expect(screen.getByText(/Hawalli/)).toBeTruthy();
  });

  it('clears the picker after adding a branch so the same branch is not added twice', () => {
    renderForm();
    fillBasics();
    addExtraBranch();
    expect((screen.getByLabelText('Extra branch') as HTMLSelectElement).value).toBe('');
  });

  it('adds an extra branch with its role and sends it with the grant', async () => {
    renderForm();
    fillBasics();
    addExtraBranch('reception');
    expect(screen.getByRole('button', { name: 'Remove the branch' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(sentBody()['additional_branches']).toEqual([{ branch_id: EXTRA, role: 'reception' }]);
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

// سقف العقد 20: الشاشة بتوقف الزيادة عنده قبل ما السيرفر يرفض الطلب.
describe('the extra-branch cap on the employee access form', () => {
  it('stops adding extra branches at the contract cap of twenty', () => {
    renderForm([
      ...CAP_BRANCHES,
      { id: PRIMARY, name_en: 'Salmiya', name_ar: null, is_active: true },
    ]);
    fillBasics();
    for (const branch of CAP_BRANCHES.slice(0, 20)) {
      fireEvent.change(screen.getByLabelText('Extra branch'), { target: { value: branch.id } });
      fireEvent.click(screen.getByRole('button', { name: 'Add a branch' }));
    }
    expect(
      (screen.getByRole('button', { name: 'Add a branch' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Up to 20 extra branches can be added.')).toBeTruthy();
  });
});

// قايمة الاستثناءات مقسّمة بالوحدة، والصلاحيات الافتراضية معلّمة بعلامة «افتراضي».
describe('the inline override picker on the employee access form', () => {
  it('groups the permission list by module and marks the role defaults', () => {
    renderForm();
    fillBasics();
    const select = screen.getByLabelText(t('en', 'invitations.overridePermissionLabel'));
    const groups = Array.from(select.querySelectorAll('optgroup'));
    expect(groups.length).toBeGreaterThan(0);
    const branches = groups.find(
      (group) => group.getAttribute('label') === permissionModuleName('en', 'branches'),
    );
    expect(branches).toBeTruthy();
    // `read:branches:branch` افتراضي لدور الموظفة، فبيطلع بعلامة «افتراضي».
    expect(branches?.querySelector('option[value="read:branches:branch"]')?.textContent).toContain(
      '(default)',
    );
    const salaries = groups.find(
      (group) => group.getAttribute('label') === permissionModuleName('en', 'salaries'),
    );
    expect(
      salaries?.querySelector('option[value="read:salaries:business"]')?.textContent,
    ).not.toContain('(default)');
  });

  it('adds an inline permission exception and sends it with the grant', async () => {
    renderForm();
    fillBasics();
    addOverride();
    expect(
      screen.getByRole('button', { name: t('en', 'invitations.removeOverride') }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(sentBody()['permission_overrides']).toEqual([EXPECTED_OVERRIDE]);
    expect(await screen.findByText(/Access granted/)).toBeTruthy();
  });
});

// سقف العقد 20 على الاستثناءات: الشاشة بتوقف الزيادة عنده قبل ما السيرفر يرفض الطلب.
describe('the inline exception cap on the employee access form', () => {
  it('stops adding inline exceptions at the contract cap of twenty', () => {
    renderForm();
    fillBasics();
    fireEvent.change(screen.getByLabelText(t('en', 'invitations.overridePermissionLabel')), {
      target: { value: 'create:customers:branch' },
    });
    fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideScopeTypeLabel')), {
      target: { value: 'BRANCH' },
    });
    fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideScopeIdLabel')), {
      target: { value: EXTRA },
    });
    for (let index = 0; index < 20; index += 1) {
      fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideReasonLabel')), {
        target: { value: `covering the front desk ${index}` },
      });
      fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.addOverride') }));
    }
    expect(
      (
        screen.getByRole('button', {
          name: t('en', 'invitations.addOverride'),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText('Up to 20 permission exceptions can be added.')).toBeTruthy();
  });
});

// أسماء وحدات الصلاحيات والعلامة «افتراضي» بتتبع النطاق المختار.
describe('the permission module names in the inline override picker', () => {
  it('names every permission module in the interface language instead of the raw key', () => {
    renderForm();
    fillBasics();
    const select = screen.getByLabelText(t('en', 'invitations.overridePermissionLabel'));
    const labels = Array.from(select.querySelectorAll('optgroup')).map((group) =>
      group.getAttribute('label'),
    );
    expect(labels).toContain(permissionModuleName('en', 'branches'));
    expect(labels).toContain(permissionModuleName('en', 'salaries'));
    expect(labels).not.toContain('branches');
    expect(labels).not.toContain('salaries');
  });

  it('names the permission modules in Arabic when the interface is Arabic', () => {
    localeState.locale = 'ar';
    renderForm();
    const select = screen.getByLabelText(t('ar', 'invitations.overridePermissionLabel'));
    const groups = Array.from(select.querySelectorAll('optgroup'));
    const branches = groups.find(
      (group) => group.getAttribute('label') === permissionModuleName('ar', 'branches'),
    );
    expect(branches).toBeTruthy();
    expect(branches?.getAttribute('label')).not.toBe('branches');
  });

  it('marks the default permissions of the branch the override targets', () => {
    renderForm();
    fillBasics();
    addExtraBranch('reception');
    const optionText = () =>
      screen
        .getByLabelText(t('en', 'invitations.overridePermissionLabel'))
        .querySelector('option[value="create:customers:branch"]')?.textContent ?? '';
    fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideScopeTypeLabel')), {
      target: { value: 'BRANCH' },
    });
    fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideScopeIdLabel')), {
      target: { value: PRIMARY },
    });
    // دور الفرع الأساسي «staff» ما فيهوش إنشاء عملاء، فمفيش علامة افتراضي.
    expect(optionText()).not.toContain('(default)');
    fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideScopeIdLabel')), {
      target: { value: EXTRA },
    });
    // فرع الزيادة دوره «reception»، ودوره بفيه إنشاء العملاء، فالعلامة بتظهر.
    expect(optionText()).toContain('(default)');
  });
});
