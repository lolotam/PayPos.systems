import { t, type Locale } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CompanyEmployeeNumbersPage } from '../company-employee-numbers-page';

export const companyId = '01920000-0000-7000-8000-0000000000a1';
export const userId = '01920000-0000-7000-8000-0000000000a2';
export const salonId = '01920000-0000-7000-8000-0000000000b1';
export const clinicId = '01920000-0000-7000-8000-0000000000b2';
const hebaId = '01920000-0000-7000-8000-0000000000c1';
export const nouraId = '01920000-0000-7000-8000-0000000000c2';
export const nextCursor = '01920000-0000-7000-8000-0000000000d1';

const heba = {
  employee_id: hebaId,
  name_ar: null,
  name_en: 'Heba',
  business_id: salonId,
  business_name_ar: null,
  business_name_en: 'Synthetic salon',
  employee_number: null as number | null,
  salary_mills: 'synthetic-salary',
  phone: 'synthetic-phone',
};

export const noura = {
  employee_id: nouraId,
  name_ar: null,
  name_en: 'Noura',
  business_id: clinicId,
  business_name_ar: null,
  business_name_en: 'Synthetic clinic',
  employee_number: 4 as number | null,
};

export function listedPage() {
  return { items: [{ ...heba }, { ...noura }], next_cursor: nextCursor };
}

export function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <CompanyEmployeeNumbersPage companyId={companyId} userId={userId} />
      </QueryClientProvider>,
    ),
  };
}

export function editName(lang: Locale, name: string) {
  return t(lang, 'companyEmployeeNumbers.editName').replace('{name}', name);
}

export async function openNoura(lang: Locale) {
  const row = await screen.findByRole('row', { name: /Noura/ });
  fireEvent.click(within(row).getByRole('button', { name: editName(lang, 'Noura') }));
}

type ListReader = {
  mockImplementation: (implementation: () => Promise<unknown>) => unknown;
};

export function hangAfterFirstPage(get: ListReader) {
  let reads = 0;
  get.mockImplementation(() => {
    reads += 1;
    if (reads === 1) return Promise.resolve({ data: listedPage() });
    return new Promise(() => undefined);
  });
  return () => reads;
}
