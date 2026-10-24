import type { ReactNode } from 'react';

import { ReceptionBody } from './reception-body';
import type { DeviceSession } from '@/device/api/use-device-session';
import { OfflineNotice } from '@/device/ui/offline-notice';
import { PairingScreen } from '@/device/ui/pairing-screen';
import { UnsupportedNotice } from '@/device/ui/unsupported-notice';
import { WaitingScreen } from '@/device/ui/waiting-screen';

import { LoadingNotice } from './loading-notice';

/** الرجوع في كود الاقتران بس ومن غير طلب شغال؛ عدم الدعم ما بيثبتش إن الجهاز غير مقترن. */
export function DeviceBody({
  session,
  startOver,
  locked = false,
}: {
  session: DeviceSession;
  startOver?: ReactNode;
  locked?: boolean;
}) {
  const { screen } = session;
  if (screen.kind === 'loading') return <LoadingNotice />;
  if (screen.kind === 'pairing') {
    return (
      <>
        <PairingScreen notice={screen.notice} onSubmit={session.submit} locked={locked} />
        {session.submitting ? null : startOver}
      </>
    );
  }
  if (screen.kind === 'waiting') return <WaitingScreen onStartOver={session.startOver} />;
  if (screen.kind === 'offline') return <OfflineNotice onRetry={session.retry} />;
  if (screen.kind === 'unsupported') return <UnsupportedNotice />;
  return <ReceptionBody branchId={screen.branchId} retry={session.retry} />;
}
