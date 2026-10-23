import type { StaffColumnsSettings } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { StaffAppColumnsPage } from '../staff-app-columns-page';

export const companyId = '01920000-0000-7000-8000-0000000000a2';
export const userId = '01920000-0000-7000-8000-0000000000a3';
export const businessId = '01920000-0000-7000-8000-0000000000a4';

export function settings(overrides: Partial<StaffColumnsSettings> = {}): StaffColumnsSettings {
  return {
    business_id: businessId,
    columns: ['date', 'time', 'service'],
    columns_default: true,
    months_back: 2,
    months_back_default: true,
    ...overrides,
  };
}

export function refusal(status: number) {
  return {
    error: { code: 'FORBIDDEN', message_ar: 'Synthetic refusal', message_en: 'Synthetic refusal' },
    response: { status },
  };
}

export function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <StaffAppColumnsPage companyId={companyId} userId={userId} businessId={businessId} />
      </QueryClientProvider>,
    ),
  };
}

export function checkbox(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement;
}
