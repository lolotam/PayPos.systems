import type { ReactNode } from 'react';

import { ReceptionBody } from './reception-body';
import type { DeviceSession } from '@/device/api/use-device-session';
import { OfflineNotice } from '@/device/ui/offline-notice';
import { PairingScreen } from '@/device/ui/pairing-screen';
import { UnsupportedNotice } from '@/device/ui/unsupported-notice';
import { WaitingScreen } from '@/device/ui/waiting-screen';

import { LoadingNotice } from './loading-notice';

/** الرجوع في كود الاقتران بس، لأن أي حالة تانية معاها اقتران أو بيانات لا يجوز تجاهلها. */
export function DeviceBody({
  session,
  startOver,
}: {
  session: DeviceSession;
  startOver?: ReactNode;
}) {
  const { screen } = session;
  if (screen.kind === 'loading') return <LoadingNotice />;
  if (screen.kind === 'pairing') {
    return (
      <>
        <PairingScreen notice={screen.notice} onSubmit={session.submit} />
        {startOver}
      </>
    );
  }
  if (screen.kind === 'waiting') return <WaitingScreen onStartOver={session.startOver} />;
  if (screen.kind === 'offline') return <OfflineNotice onRetry={session.retry} />;
  if (screen.kind === 'unsupported') return <UnsupportedNotice />;
  return <ReceptionBody branchId={screen.branchId} retry={session.retry} />;
}
