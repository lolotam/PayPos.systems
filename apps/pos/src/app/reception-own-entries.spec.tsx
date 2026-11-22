import { screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { installFetch, renderWork } from '@/my-work/ui/work-test-kit';
import { ReceptionOwnEntries } from './reception-own-entries';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const session = {
  user_id: id(1),
  company_id: id(2),
  business_id: id(3),
  branch_id: id(5),
  device_id: id(6),
  expires_at: '2026-12-01T10:00:00.000Z',
};
const entries = (deviceId: string | undefined) => (
  <ReceptionOwnEntries
    session={session}
    epoch={0}
    branchId={id(5)}
    deviceId={deviceId}
    zone={null}
  />
);

afterEach(() => vi.unstubAllGlobals());

it('shows both the own-leave and the own-work buttons under the operator of the paired device', () => {
  installFetch(() => undefined);
  renderWork(entries(id(6)));
  expect(screen.getByRole('button', { name: t('en', 'myLeave.title') })).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'myWork.title') })).toBeTruthy();
});

it('shows neither when the operator session does not match the device', () => {
  installFetch(() => undefined);
  renderWork(entries(id(7)));
  expect(screen.queryByRole('button', { name: t('en', 'myWork.title') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'myLeave.title') })).toBeNull();
});
