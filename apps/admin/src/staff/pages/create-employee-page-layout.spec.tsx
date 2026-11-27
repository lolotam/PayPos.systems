import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EditEmployeeForm } from '../ui/edit-employee-form';
import { CreateEmployeePage } from './create-employee-page';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../api/use-employee-number-capability', () => ({
  useEmployeeNumberCapability: () => ({ data: { can_type_number: true }, isError: false }),
}));
vi.mock('../api/use-create-employee', () => ({
  useCreateEmployee: () => ({
    isPending: false,
    isSuccess: false,
    isError: false,
    mutate: vi.fn(),
    error: null,
    variables: undefined,
    data: undefined,
  }),
}));

const id = '01920000-0000-7000-8000-0000000000a2';
const branch = {
  id,
  name_en: 'Synthetic branch',
  name_ar: null,
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};
const business = {
  id,
  name_en: 'Synthetic business',
  name_ar: null,
  business_type: 'salon' as const,
  country: null,
  branches: [branch],
};

function renderPage() {
  render(<CreateEmployeePage companyId={id} business={business} userId={id} />);
}

function follows(first: Node, second: Node) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function section(title: string) {
  return screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement;
}

it('opens as a form page with one heading', () => {
  renderPage();
  const heading = screen.getByRole('heading', { level: 1, name: 'Create employee' });
  expect(heading.closest('[data-page-shell="form"]')).not.toBeNull();
});

it('puts every field in one card, in two titled sections, in the same order as before', () => {
  renderPage();
  const details = section('Employee details');
  const employment = section('Employment');
  expect(follows(details, employment)).toBe(true);
  const card = details.closest('.rounded-card') as HTMLElement;
  expect(card.contains(employment)).toBe(true);
  expect(within(details).getAllByRole('textbox')).toHaveLength(3);
  expect(within(details).getByLabelText('English name')).toBeTruthy();
  expect(within(details).getByLabelText('Arabic name (optional)')).toBeTruthy();
  expect(within(details).getByLabelText('Recovery email (optional)')).toBeTruthy();
  const order = ['Primary branch', 'Role', 'Hire date', 'Contract end (optional)'].map((label) =>
    within(employment).getByLabelText(label),
  );
  order.push(
    within(employment).getByLabelText('Existing user ID (optional)'),
    within(employment).getByLabelText('Employee number'),
  );
  order.slice(1).forEach((field, index) => expect(follows(order[index] as Node, field)).toBe(true));
});

it('keeps each label and its control together in one cell', () => {
  renderPage();
  const labels = [
    'English name',
    'Arabic name (optional)',
    'Recovery email (optional)',
    'Primary branch',
    'Role',
    'Hire date',
    'Contract end (optional)',
    'Existing user ID (optional)',
    'Employee number',
  ];
  labels.forEach((label) => {
    const control = screen.getByLabelText(label);
    const cell = screen.getByText(label, { selector: 'label' }).parentElement as HTMLElement;
    expect(cell.contains(control)).toBe(true);
    expect(cell.querySelectorAll('label')).toHaveLength(1);
  });
});

it('spans names and selects 6 columns, dates 4, the user ID the full row', () => {
  renderPage();
  const cellOf = (label: string) =>
    screen.getByText(label, { selector: 'label' }).parentElement as HTMLElement;
  ['English name', 'Arabic name (optional)', 'Primary branch', 'Role'].forEach((label) =>
    expect(cellOf(label).className).toContain('md:col-span-6'),
  );
  ['Hire date', 'Contract end (optional)'].forEach((label) =>
    expect(cellOf(label).className).toContain('md:col-span-4'),
  );
  expect(cellOf('Existing user ID (optional)').className).not.toContain('md:col-span');
  expect(cellOf('Existing user ID (optional)').className).toContain('col-span-12');
});

it('puts the create action last at the foot of the card', () => {
  renderPage();
  const submit = screen.getByRole('button', { name: 'Create employee' });
  const card = submit.closest('.rounded-card') as HTMLElement;
  const details = section('Employee details');
  expect(card.contains(details)).toBe(true);
  expect(follows(section('Employment'), submit)).toBe(true);
  const buttons = within(card).getAllByRole('button');
  expect(buttons.at(-1)).toBe(submit);
  expect(submit.getAttribute('type')).toBe('submit');
});

it('does not move the shared fields into grid cells on the edit form', () => {
  render(
    <EditEmployeeForm
      companyId={id}
      businessId={id}
      record={{
        id,
        business_id: id,
        primary_branch_id: id,
        name_en: 'Synthetic employee',
        name_ar: null,
        role_code: 'staff' as const,
        hire_date: '2026-01-01',
        contract_end: null,
        user_id: null,
        created_at: '2026-10-03T00:00:00Z',
        revision: 1,
        recovery_email: null,
        branch_ids: [id],
        employee_number: 4,
      }}
      branches={[branch]}
      pending={false}
      onSave={vi.fn()}
    />,
  );
  const english = screen.getByLabelText('English name');
  expect(english.parentElement?.contains(screen.getByLabelText('Arabic name (optional)'))).toBe(
    true,
  );
  fireEvent.change(english, { target: { value: 'Synthetic renamed' } });
  expect((english as HTMLInputElement).value).toBe('Synthetic renamed');
});
