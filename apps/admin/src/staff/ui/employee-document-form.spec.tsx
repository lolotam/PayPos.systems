import { employeeDocumentFormInput, type EmployeeDocumentFormValues } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeDocumentForm } from './employee-document-form';
import { documentColumns } from './employee-document-columns';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

afterEach(() => {
  cleanup();
});

const types = [
  {
    id: '01920000-0000-7000-8000-0000000000a1',
    code: 'civil_id',
    name_en: 'Civil ID',
    name_ar: null,
    alert_days: 30,
    requires_expiry: false,
    active: true,
    revision: 1,
  },
];
const renderForm = (onSubmit: (submission: { values: EmployeeDocumentFormValues }) => void) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmployeeDocumentForm types={types} pending={false} onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
const attachFile = () => {
  const input = screen.getByLabelText('File (PDF, JPEG or PNG, up to 10 MB)') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['pdf'], 'doc.pdf', { type: 'application/pdf' })] },
  });
};

it('DN-21 trims the typed number before submitting and sends an empty field as an empty value', async () => {
  const onSubmit = vi.fn();
  renderForm(onSubmit);
  attachFile();
  const number = screen.getByLabelText('Document number (optional)') as HTMLInputElement;
  fireEvent.change(number, { target: { value: '  SYN-DOC-0021  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and record' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      values: expect.objectContaining({ document_number: 'SYN-DOC-0021' }),
    }),
  );
  fireEvent.change(number, { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and record' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  expect(onSubmit).toHaveBeenLastCalledWith(
    expect.objectContaining({ values: expect.objectContaining({ document_number: '   ' }) }),
  );
});

it('DN-21 shows the field-specific translated error for a control character and submits nothing', async () => {
  const onSubmit = vi.fn();
  renderForm(onSubmit);
  attachFile();
  const number = screen.getByLabelText('Document number (optional)');
  fireEvent.change(number, { target: { value: 'SYN\u0007DOC' } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and record' }));
  const fieldError = await screen.findByRole('alert');
  expect(fieldError.textContent).toBe('The document number is invalid.');
  expect(onSubmit).not.toHaveBeenCalled();
  expect(
    employeeDocumentFormInput.safeParse({
      type_code: 'civil_id',
      expires_on: '',
      document_number: 'SYN\u0007DOC',
    }).success,
  ).toBe(false);
});

it('DN-21 shows a translated field-specific error, then submits successfully once corrected', async () => {
  const onSubmit = vi.fn();
  renderForm(onSubmit);
  attachFile();
  const number = screen.getByLabelText('Document number (optional)') as HTMLInputElement;
  fireEvent.change(number, { target: { value: 'SYN\u0007DOC' } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and record' }));
  const fieldError = await screen.findByRole('alert');
  expect(fieldError.textContent).toBe('The document number is invalid.');
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(number, { target: { value: 'SYN-DOC-0065' } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and record' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      values: expect.objectContaining({ document_number: 'SYN-DOC-0065' }),
    }),
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('DN-21 the table shows the number and an em dash placeholder', () => {
  const base = {
    id: '01920000-0000-7000-8000-0000000000b1',
    employee_id: '01920000-0000-7000-8000-0000000000b2',
    type_code: 'civil_id',
    type_name_en: 'Civil ID',
    type_name_ar: null,
    object_key: 'company/business/key',
    expires_on: null,
    uploaded_by: '01920000-0000-7000-8000-0000000000b3',
    recorded_at: '2026-11-21T00:00:00.000Z',
    status: 'NO_EXPIRY' as const,
    document_number: null as string | null,
  };
  const columns = documentColumns('en', {
    canManage: false,
    opening: false,
    onOpen: () => undefined,
    onReplace: () => undefined,
  });
  const numberColumn = columns.find((column) => column.id === 'number');
  const get = (row: typeof base) =>
    numberColumn &&
    (numberColumn.cell as (context: { row: { original: typeof base } }) => unknown)({
      row: { original: row },
    });
  expect(get({ ...base, document_number: 'SYN-DOC-0022' })).toBe('SYN-DOC-0022');
  expect(get({ ...base, document_number: null })).toBe('—');
});
