import type { ReactNode } from 'react';
import type { StaffSessionContext } from '@pospay/contracts';
import { useStaffLogin } from '../api/use-staff-login';
import { StaffLoginPanel } from './staff-login-panel';

export function StaffLoginScreen({
  ownLeave,
}: { ownLeave?: (session: StaffSessionContext, epoch: number) => ReactNode } = {}) {
  const login = useStaffLogin();
  return <StaffLoginPanel login={login} ownLeave={ownLeave} />;
}
