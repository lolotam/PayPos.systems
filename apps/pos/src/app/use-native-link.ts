import { useEffect, useRef } from 'react';

import {
  markLaunchLinkHandled,
  onLinkOpened,
  readLaunchLink,
} from '@/shared/platform/launch-links';

import { readDeviceRole, readRememberedBusiness, type DeviceRole } from './device-role';
import type { KnownShellState } from './link-rules';
import { readManagerLink, type PersonalWorkspace } from './manager-link';

async function readStartupShell() {
  const [roleResult, businessResult, link] = await Promise.all([
    Promise.resolve()
      .then(() => readDeviceRole())
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        () => ({ status: 'rejected' as const }),
      ),
    Promise.resolve()
      .then(() => readRememberedBusiness())
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        () => ({ status: 'rejected' as const }),
      ),
    readLaunchLink(),
  ]);
  return {
    role: roleResult.status === 'fulfilled' ? roleResult.value : null,
    business: businessResult.status === 'fulfilled' ? businessResult.value : null,
    businessUnreadable: businessResult.status === 'rejected',
    storageFailed: roleResult.status === 'rejected' || businessResult.status === 'rejected',
    link,
  };
}

interface WarmLinkState {
  superseded: boolean;
  handled: boolean;
  deferredColdLink: string | null;
}

let retireSupersededColdLink: (() => void) | null = null;

/** يعلّم أي لينك تشغيل بارد متأخر إنه اتقفل بعد نجاح لينك دافي أو حسم لوحة التبديل. */
export function notifyColdLinkSupersededAndRetired(): void {
  retireSupersededColdLink?.();
}

function retireDeferredColdLink(warmState: WarmLinkState): void {
  warmState.superseded = true;
  warmState.handled = true;
  if (warmState.deferredColdLink !== null) {
    markLaunchLinkHandled(warmState.deferredColdLink);
    warmState.deferredColdLink = null;
  }
}

function handleLateColdLink(link: string, warmState: WarmLinkState): void {
  if (warmState.handled) markLaunchLinkHandled(link);
  else warmState.deferredColdLink = link;
}

/**
 * بيقرا حالة الجهاز أول ما التطبيق يفتح، وبيسمع للينكات اللي بتتفتح والتطبيق شغال.
 *
 * القراءة الأولى بتجيب الدور والنشاط واللينك مع بعض، عشان الشاشة تفتح مرة واحدة بالحالة الصح.
 * كل قراءة لوحدها، فاللي يفشل ما بيأثرش على اللي نجح: الشاشة بتفتح باللي معروف، والتنبيه
 * بيقول إن القراءة فشلت (FR-012). بصمة اللينك بتتسجل بس بعد ما يتطبّق، عشان الإلغاء أو
 * الفشل المؤقت ما يضيعوش اللينك.
 *
 * @param onStart بيتنادى لما التطبيق فتح من غير لينك أو القراءة فشلت
 * @param onLink  بيتنادى بكل لينك ويرجع true لو اللينك اتطبّق ومش محتاج إعادة
 */
export function useNativeLink(
  onStart: (
    role: DeviceRole | null,
    business: PersonalWorkspace | null,
    readFailed?: boolean,
    businessUnreadable?: boolean,
  ) => void,
  onLink: (workspace: PersonalWorkspace | null, fallback?: KnownShellState) => Promise<boolean>,
): void {
  // لو لينك دافي صالح وصل وقراءة التشغيل البارد لسه ما خلصتش، بنمنع اللينك البارد المتأخر من غير ما نقفله لو الدافي فشل.
  const warmState = useRef<WarmLinkState>({
    superseded: false,
    handled: false,
    deferredColdLink: null,
  });

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const { role, business, businessUnreadable, storageFailed, link } = await readStartupShell();
      if (cancelled) return;
      if (link !== null && warmState.current.superseded) {
        handleLateColdLink(link, warmState.current);
        return;
      }
      if (link === null) {
        onStart(role, business, storageFailed, businessUnreadable);
        return;
      }
      // لينك فوق تخزين ناقص: ما نطبّقش اللينك وما نستهلكوش، عشان نشاط متذكر صحيح ما يضيعش.
      if (storageFailed) {
        onStart(role, business, true, businessUnreadable);
        return;
      }
      const handled = await onLink(readManagerLink(link), { role, business });
      if (!cancelled && handled) markLaunchLinkHandled(link);
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [onStart, onLink]);

  useEffect(() => {
    const retire = () => retireDeferredColdLink(warmState.current);
    retireSupersededColdLink = retire;
    const stop = onLinkOpened((raw) => {
      const parsed = readManagerLink(raw);
      if (parsed !== null) warmState.current.superseded = true;
      void onLink(parsed).then((handled) => {
        if (parsed !== null && handled) retire();
      });
    });
    return () => {
      if (retireSupersededColdLink === retire) retireSupersededColdLink = null;
      stop();
    };
  }, [onLink]);
}
