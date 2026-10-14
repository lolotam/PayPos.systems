import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { expect, it, vi } from 'vitest';
import { createSessionDraft, type SessionDraftForm } from '../model/session-drafts';
import { SessionRecordingHeader } from './session-recording-header';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const membershipId = '01920000-0000-7000-8000-0000000000a2';
const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
const context = {
  generated_at: '2026-10-13T08:00:00.000Z', business_timezone: 'Asia/Kuwait',
  recorder_membership_ids: [membershipId], recorder_membership_id: membershipId,
  discount_limit: { source: 'PERSON' as const, bps: 1000 },
};

function Harness() {
  const form = useForm<SessionDraftForm>({ defaultValues: { lines: [{ ...createSessionDraft('kept'), price: '7.125' }], recorder_membership_id: membershipId } });
  return <FormProvider {...form}><SessionRecordingHeader scope={scope} disabled={false} /></FormProvider>;
}

it('shows the resolved limit in the draft summary', async () => {
  get.mockResolvedValue({ data: context });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  await waitFor(() => expect(screen.getAllByText('10.00%')).toHaveLength(2));
  const summary = screen.getByText(t('en', 'serviceSessions.draftTotal'), { exact: false }).parentElement;
  expect(summary?.textContent).toContain('7.125');
  expect(summary?.textContent).toContain('10.00%');
  expect(summary?.textContent).toContain(t('en', 'serviceSessions.limitPerson'));
});
