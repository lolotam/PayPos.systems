import { useCallback, useRef, type ReactNode } from 'react';

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
  const lastBindingRetry = useRef('');
  const bindingConfirmed = useCallback(() => {
    lastBindingRetry.current = '';
  }, []);
  // إعادة تركيب الاستقبال بعد boot لا تعيد محاولة نفس الربط المرفوض تلقائياً بلا نهاية.
  const retryBinding = useCallback(async () => {
    if (screen.kind !== 'ready') return;
    const binding = `${screen.branchId}:${screen.deviceId}`;
    if (lastBindingRetry.current === binding) return;
    lastBindingRetry.current = binding;
    await session.retry();
  }, [screen, session]);
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
  return (
    <ReceptionBody
      key={`${screen.branchId}:${screen.deviceId}`}
      deviceId={screen.deviceId}
      branchId={screen.branchId}
      retry={session.retry}
      retryBinding={retryBinding}
      bindingConfirmed={bindingConfirmed}
    />
  );
}
