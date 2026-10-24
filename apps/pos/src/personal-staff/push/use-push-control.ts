import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PushConfig } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';
import { attendanceInstallationId } from '../model/installation-id';
import {
  currentSubscription,
  hasPushManager,
  isIosDevice,
  isStandalone,
  notificationPermission,
  supportsPush,
  type PushPermission,
} from './push-browser';
import { pushCalls } from './push-calls';
import { disablePush } from './push-disable';
import { enablePush } from './push-enable';
import { onPushRecordChanged } from './push-record-events';
import { pushRecordStore } from './push-record-idb';
import type { PushRecord } from './push-record';
import { refreshPush } from './push-refresh';
import { decidePushState } from './push-state';

const INVITATION_KEY = 'pospay.push.invitationSeen';

interface LocalSnapshot {
  record: PushRecord | null;
  permission: PushPermission;
  subscribed: boolean;
}

const EMPTY_SNAPSHOT: LocalSnapshot = { record: null, permission: 'default', subscribed: false };

interface PushLocalState {
  snapshot: LocalSnapshot;
  loaded: boolean;
  installationId: string | null;
  storageBlocked: boolean;
  seen: boolean;
  reload: () => Promise<void>;
  markSeen: () => void;
}

function invitationSeen(): boolean {
  try {
    return localStorage.getItem(INVITATION_KEY) === '1';
  } catch {
    // تخزين متعطل: مش هنعرف إن الموظفة شافت الدعوة، فبنعتبرها شافتها وبنخفيها.
    return true;
  }
}

function markInvitationSeen(): void {
  try {
    localStorage.setItem(INVITATION_KEY, '1');
  } catch {
    // فشل الحفظ معناه إن الدعوة هتفضل مخفية في الجلسة دي بس.
  }
}

/** بيكشف إن المتصفح بيمنع التخزين قبل أي طلب: من غير تخزين مفيش تسجيل ولا إلغاء (FR-010). */
function storageBlockedProbe(): boolean {
  try {
    attendanceInstallationId();
    return false;
  } catch {
    return true;
  }
}

function usePushLocalState(): PushLocalState {
  const [storageBlocked] = useState(storageBlockedProbe);
  const [snapshot, setSnapshot] = useState<LocalSnapshot>(EMPTY_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [seen, setSeen] = useState(true);

  const reload = useCallback(async () => {
    const record = await pushRecordStore.read().catch(() => null);
    const permission = notificationPermission();
    const subscribed = supportsPush()
      ? (await currentSubscription().catch(() => null)) !== null
      : false;
    setSnapshot({ record, permission, subscribed });
    setLoaded(true);
  }, []);

  const markSeen = useCallback(() => {
    markInvitationSeen();
    setSeen(true);
  }, []);

  useEffect(() => {
    if (!storageBlocked) {
      try {
        setInstallationId(attendanceInstallationId());
      } catch {
        setInstallationId(null);
      }
    }
    setSeen(invitationSeen());
    void reload();
  }, [reload, storageBlocked]);

  // فحص التوقيع والتشغيل والإيقاف بيغيّروا السجل من برّه الـ hook، فالزر بيقرأ تاني
  // كل ما السجل يتغيّر (ADR-0052 §7).
  useEffect(() => onPushRecordChanged(() => void reload()), [reload]);

  return { snapshot, loaded, installationId, storageBlocked, seen, reload, markSeen };
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    return () => {
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
    };
  }, []);
  return online;
}

function usePushConfig(storageBlocked: boolean) {
  const query = useQuery({
    queryKey: ['staff-push-config'],
    queryFn: () => pushCalls.config(),
    retry: false,
    staleTime: 30_000,
    enabled: !storageBlocked,
  });
  return {
    config: query.data?.kind === 'ready' ? query.data.config : null,
    notReady: query.data?.kind === 'not-ready',
    settled: query.fetchStatus !== 'fetching',
  };
}

function usePushRefresh(input: {
  companyId: string;
  locale: Locale;
  config: PushConfig | null;
  local: PushLocalState;
  registered: RefObject<string | null>;
}) {
  const refreshed = useRef('');
  const { companyId, locale, config, local, registered } = input;
  const record = local.snapshot.record;
  const installationId = local.installationId;
  const reload = local.reload;
  useEffect(() => {
    if (config === null || record === null || installationId === null) return;
    // السجل ده اتسجل دلوقتي: التسجيل نفسه عمل الـ PUT، فالتحديث التاني هيبقى تكرار.
    if (record.token === registered.current) return;
    const signature = `${record.token}|${locale}`;
    if (refreshed.current === signature) return;
    refreshed.current = signature;
    void refreshPush({ companyId, locale, config, installationId })
      .then((outcome) => {
        if (outcome.kind === 'rotated') refreshed.current = `${outcome.token}|${locale}`;
        if (outcome.kind !== 'none') void reload();
      })
      .catch(() => undefined);
  }, [companyId, config, installationId, locale, record, registered, reload]);
}

function usePushActions(input: {
  companyId: string;
  locale: Locale;
  installationId: string | null;
  reload: () => Promise<void>;
  markSeen: () => void;
  onEnabled: (token: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const { companyId, locale, installationId, reload, markSeen, onEnabled } = input;

  const enable = useCallback(async () => {
    if (pending || installationId === null) return;
    setPending(true);
    setFailed(false);
    markSeen();
    try {
      const outcome = await enablePush({ companyId, locale, installationId });
      if (outcome.kind === 'enabled') onEnabled(outcome.token);
      if (outcome.kind === 'failed') setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
      await reload();
    }
  }, [companyId, installationId, locale, markSeen, onEnabled, pending, reload]);

  const disable = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      await disablePush(installationId);
    } catch {
      // الإيقاف بيمسح السجل في كل الأحوال؛ فشل الشبكة بيسيب الحالة مقفولة.
    } finally {
      setPending(false);
      await reload();
    }
  }, [installationId, pending, reload]);

  return { pending, failed, enable, disable };
}

/**
 * حالة زر إشعارات الموبايل في شاشة الموظف: حالة واحدة من الخمسة، والتدفقات اللي وراها.
 *
 * @param input الشركة من الجلسة
 * @returns الحالة المعروضة والأفعال
 */
export function usePushControl({ companyId }: { companyId: string }) {
  const locale = useLocale();
  const local = usePushLocalState();
  const online = useOnlineStatus();
  const config = usePushConfig(local.storageBlocked);
  const registered = useRef<string | null>(null);
  const actions = usePushActions({
    companyId,
    locale,
    installationId: local.installationId,
    reload: local.reload,
    markSeen: local.markSeen,
    onEnabled: (token: string) => {
      registered.current = token;
    },
  });
  usePushRefresh({ companyId, locale, config: config.config, local, registered });
  const decision = decidePushState({
    notReady: config.notReady,
    storageBlocked: local.storageBlocked,
    supported: supportsPush(),
    installFirst: isIosDevice() && !isStandalone() && !hasPushManager(),
    permission: local.snapshot.permission,
    online,
    record: local.snapshot.record,
    companyId,
    browserSubscribed: local.snapshot.subscribed,
    reconnecting: local.snapshot.record?.suspended === true,
  });
  return {
    visible: decision.visible && local.loaded && config.settled,
    state: decision.state,
    storageBlocked: decision.storageBlocked,
    offline: decision.offline,
    reconnecting: decision.reconnecting,
    pending: actions.pending,
    failed: actions.failed,
    invitation:
      decision.visible &&
      decision.state === 'off' &&
      local.snapshot.permission === 'default' &&
      !local.seen,
    enable: actions.enable,
    disable: actions.disable,
    dismissInvitation: local.markSeen,
  };
}
