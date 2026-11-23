import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAccessSection } from './employee-access-section';

window.HTMLElement.prototype.scrollIntoView = () => undefined;

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const deleteFn = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  status: 200 as number,
  body: null as unknown,
}));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: get, POST: post, DELETE: deleteFn }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function accessResponse() {
  if (state.status >= 400) {
    const body = state.body as { message_en: string; message_ar: string };
    return {
      response: { status: state.status, ok: false },
      data: undefined,
      error: { code: 'NOT_READY', message_en: body.message_en, message_ar: body.message_ar },
    };
  }
  return { response: { status: 200, ok: true }, data: state.body as unknown, error: undefined };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  deleteFn.mockReset();
  state.status = 200;
});

describe('the employee access section visible states', () => {
  it('AC-F1-1 shows the active state with the role and the phone last three digits only', async () => {
    state.body = {
      state: 'ACTIVE',
      role: 'staff',
      branch_id: '01920000-0000-7000-8000-000000000001',
      phone_last3: '678',
      can_manage: false,
    };
    get.mockResolvedValue(accessResponse());
    render(
      wrap(
        <EmployeeAccessSection
          companyId="01920000-0000-7000-8000-00000000000a"
          businessId="01920000-0000-7000-8000-00000000000b"
          userId="01920000-0000-7000-8000-00000000000c"
          employeeId="01920000-0000-7000-8000-00000000000d"
        />,
      ),
    );
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    expect(screen.getByText('Employee')).toBeTruthy();
    expect(screen.getByText('678')).toBeTruthy();
    expect(screen.queryByText('+96512345678')).toBeNull();
    expect(screen.queryByText('Give access')).toBeNull();
  });

  it('AC-F1-1 offers «Give access» only when the state says NONE and can_manage is true', async () => {
    state.body = { state: 'NONE', role: null, branch_id: null, phone_last3: null, can_manage: true };
    get.mockResolvedValue(accessResponse());
    render(
      wrap(
        <EmployeeAccessSection
          companyId="01920000-0000-7000-8000-00000000000a"
          businessId="01920000-0000-7000-8000-00000000000b"
          userId="01920000-0000-7000-8000-00000000000c"
          employeeId="01920000-0000-7000-8000-00000000000d"
        />,
      ),
    );
    await waitFor(() => expect(screen.getByText('No access yet.')).toBeTruthy());
    const button = screen.getByText('Give access');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText('I confirmed this number is hers')).toBeTruthy());
    // AC-F1-5: the confirmation tick is required before the request can be sent.
    expect(screen.getByRole('alert').textContent).toBe('Tick the confirmation before saving.');
  });

  it('FR-F1-9 the section disappears entirely when the capability answers 503 NOT_READY', async () => {
    state.status = 503;
    state.body = { code: 'NOT_READY', message_en: 'not ready', message_ar: 'غير جاهز' };
    get.mockResolvedValue(accessResponse());
    const { container } = render(
      wrap(
        <EmployeeAccessSection
          companyId="01920000-0000-7000-8000-00000000000a"
          businessId="01920000-0000-7000-8000-00000000000b"
          userId="01920000-0000-7000-8000-00000000000c"
          employeeId="01920000-0000-7000-8000-00000000000d"
        />,
      ),
    );
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });

  it('AC-F1-6b offers the pending cancel for a PENDING record the caller may manage', async () => {
    state.body = {
      state: 'PENDING',
      role: 'reception',
      branch_id: '01920000-0000-7000-8000-000000000001',
      phone_last3: null,
      can_manage: true,
    };
    get.mockResolvedValue(accessResponse());
    render(
      wrap(
        <EmployeeAccessSection
          companyId="01920000-0000-7000-8000-00000000000a"
          businessId="01920000-0000-7000-8000-00000000000b"
          userId="01920000-0000-7000-8000-00000000000c"
          employeeId="01920000-0000-7000-8000-00000000000d"
        />,
      ),
    );
    await waitFor(() =>
      expect(screen.getByText('Reception / cashier')).toBeTruthy(),
    );
    expect(screen.getByText('Cancel pending grant')).toBeTruthy();
  });
});
