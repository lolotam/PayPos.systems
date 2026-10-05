import { StaffLoginScreen } from '@/staff-login/ui/staff-login-screen';
import { AttendanceHome } from '@/attendance/ui/attendance-home';
import { ClockByCardScreen } from '@/attendance/ui/clock-by-card-screen';
import type { DeviceSession } from '@/device/api/use-device-session';
import { OfflineNotice } from '@/device/ui/offline-notice';
import { PairingScreen } from '@/device/ui/pairing-screen';
import { UnsupportedNotice } from '@/device/ui/unsupported-notice';
import { WaitingScreen } from '@/device/ui/waiting-screen';

import { LoadingNotice } from './loading-notice';

export function DeviceBody({ session }: { session: DeviceSession }) {
  const { screen } = session;
  if (screen.kind === 'loading') return <LoadingNotice />;
  if (screen.kind === 'pairing') {
    return <PairingScreen notice={screen.notice} onSubmit={session.submit} />;
  }
  if (screen.kind === 'waiting') return <WaitingScreen onStartOver={session.startOver} />;
  if (screen.kind === 'offline') return <OfflineNotice onRetry={session.retry} />;
  if (screen.kind === 'unsupported') return <UnsupportedNotice />;
  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-12 lg:grid-cols-2">
      <StaffLoginScreen />
      <AttendanceHome branchId={screen.branchId} onRejected={session.retry} />
      <ClockByCardScreen />
    </div>
  );
}
