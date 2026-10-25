import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PushConfig } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';
import { attendanceInstallationId } from '../model/installation-id';
import {
  canEnablePush,
  currentSubscription,
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
import { useRefreshRetry } from './use-refresh-retry';

const INVITATION_KEY = 'pospay.push.invitationSeen';

/** هوية فاضية: بتستخدم لما الإعدادات لسه ما وصلتش، فالتوقيع يفضل معروف. */
const EMPTY_IDENTITY = { vapid_key_id: '', subscriber_ref: '', company_id: '' };

/**
 * توقيع التحديث: السجل واللغة والمفتاح وهوية الجلسة. هوية تانية (شخص تاني أو شركة تانية)
 * توقيع تاني، فالتحديث الجديد مش تكرار للتحديث اللي خلص (ADR-0052 §7).
 */
function refreshSignature(
  token: string,
  locale: Locale,
  identity: Pick<PushConfig, 'vapid_key_id' | 'subscriber_ref' | 'company_id'>,
): string {
  const { vapid_key_id, subscriber_ref, company_id } = identity;
  return `${token}|${locale}|${vapid_key_id}|${subscriber_ref}|${company_id}`;
}

interface LocalSnapshot {
  record: PushRecord | null;
  /** قراءة السجل فشلت: السجل مش معروف، فمفيش حاجة نعدّلها. */
  recordReadFailed: boolean;
  permission: PushPermission;
  subscribed: boolean;
}

const EMPTY_SNAPSHOT: LocalSnapshot = {
  record: null,
  recordReadFailed: false,
  permission: 'default',
  subscribed: false,
};

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
    let record: PushRecord | null;
    let recordReadFailed = false;
    try {
      record = await pushRecordStore.read();
    } catch {
      // القراءة فشلت: السجل مش معروف، فبنعتبره مش موجود بس من غير ما نمدّ إيدنا.
      recordReadFailed = true;
      record = null;
    }
    const permission = notificationPermission();
    const subscribed = supportsPush()
      ? (await currentSubscription().catch(() => null)) !== null
      : false;
    setSnapshot({ record, recordReadFailed, permission, subscribed });
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
  const queryClient = useQueryClient();
  const refreshed = useRef('');
  const inFlight = useRef('');
  const failed = useRef('');
  const { companyId, locale, config, local, registered } = input;
  const record = local.snapshot.record;
  const installationId = local.installationId;
  const reload = local.reload;
  useEffect(() => {
    if (config === null || record === null || installationId === null) return;
    // المفتاح الجديد وهوية الجلسة كمان جزء من التوقيع: تغيير المفتاح وهو فاتح الشاشة
    // لازم يصلّح الاشتراك، وجلسة تانية لازم ماترجعش تسجّل في مكان حد تاني.
    const signature = refreshSignature(record.token, locale, config);
    // السجل ده اتسجل دلوقتي: التسجيل نفسه عمل الـ PUT، فالتحديث التاني هيبقى تكرار.
    if (signature === registered.current) return;
    // التحديث شغال أو خلص أو فشل: ما نعيدش نفس الطلب في نفس اللحظة (ADR-0052 §7).
    if (signature === inFlight.current || signature === refreshed.current) return;
    if (signature === failed.current) return;
    inFlight.current = signature;
    void refreshPush({ companyId, locale, config, installationId })
      .then((outcome) => {
        inFlight.current = '';
        if (outcome.kind === 'session-changed') {
          // التعليق أو التدوير المتوقف غيّر العالم: اللقطة المحلية لازم تتقرا تاني،
          // والتوقيع اتعلّم عشان متحاولش نفس الجلسة القديمة تاني (ADR-0052 §7).
          failed.current = signature;
          void queryClient.invalidateQueries({ queryKey: ['staff-push-config'] });
          void reload();
          return;
        }
        // نتيجة "ولا حاجة" (صلاحية ناقصة أو معرف تثبيت ناقص) بتتعلّم كمحاولة فاشلة:
        // التحديث بيتعاد بس لما المستخدم يرجع ويسمح، ومفيش إعادة قراءة دايرة (FR-019).
        if (outcome.kind === 'none') {
          failed.current = signature;
          return;
        }
        if (outcome.kind === 'rotated') {
          // التوقيع بعد التدوير بيتبني بالمفتاح اللي اتعمل بيه الاشتراك الجديد، مش
          // بالمفتاح القديم اللي في الإعدادات (ADR-0052 §7).
          const rotated = { ...config, vapid_key_id: outcome.vapid_key_id };
          refreshed.current = refreshSignature(outcome.token, locale, rotated);
        } else {
          refreshed.current = signature;
        }
        void reload();
      })
      .catch(() => {
        // التحديث فشل: ما نعملش reload (هيعيد تشغيل الطلب فورًا)، والعRetry بيحصل
        // بس لما المستخدم يرجع للتطبيق أو الشبكة تيجي (ADR-0052 §7).
        inFlight.current = '';
        failed.current = signature;
      });
  }, [companyId, config, installationId, locale, queryClient, record, registered, reload]);
  const retry = useCallback(() => {
    failed.current = '';
  }, []);
  return { retry };
}

function usePushActions(input: {
  companyId: string;
  locale: Locale;
  installationId: string | null;
  record: PushRecord | null;
  recordReadFailed: boolean;
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
      const outcome = await enablePush({
        companyId,
        locale,
        installationId,
        onRegistered: onEnabled,
      });
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
    // القراءة اللي على الشاشة فشلت: السجل مش معروف، فمفيش حاجة نمسحها.
    if (input.recordReadFailed) return;
    setPending(true);
    setFailed(false);
    try {
      // الإيقاف بيمشي على لقطة السجل المعروضة: لو تبويب تاني غيّره، ما نعملش حاجة.
      const outcome = await disablePush(installationId, {
        token: input.record?.token ?? null,
        revision: input.record?.revision ?? 0,
      });
      if (outcome === 'failed') setFailed(true);
    } catch {
      // الإيقاف بيمسح السجل في كل الأحوال؛ فشل الشبكة بيسيب الحالة مقفولة.
    } finally {
      setPending(false);
      await reload();
    }
  }, [installationId, input.record, input.recordReadFailed, pending, reload]);

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
    record: local.snapshot.record,
    recordReadFailed: local.snapshot.recordReadFailed,
    reload: local.reload,
    markSeen: local.markSeen,
    onEnabled: (token: string) => {
      // التوقيع المسجَّل: نفس السجل بنفس اللغة ونفس المفتاح ونفس هوية الجلسة يعني إن
      // الـ PUT اتعمل خلاص.
      registered.current = refreshSignature(token, locale, config.config ?? EMPTY_IDENTITY);
    },
  });
  const refresh = usePushRefresh({ companyId, locale, config: config.config, local, registered });
  useRefreshRetry(refresh.retry, local.reload);
  const decision = decidePushState({
    notReady: config.notReady,
    storageBlocked: local.storageBlocked,
    supported: supportsPush(),
    installFirst: isIosDevice() && !isStandalone(),
    permission: local.snapshot.permission,
    online,
    record: local.snapshot.record,
    companyId,
    browserSubscribed: local.snapshot.subscribed,
    reconnecting: local.snapshot.record?.suspended === true,
    canEnable: canEnablePush(),
    recordReadFailed: local.snapshot.recordReadFailed,
  });
  return {
    visible: decision.visible && local.loaded && config.settled,
    state: decision.state,
    storageBlocked: decision.storageBlocked,
    offline: decision.offline,
    reconnecting: decision.reconnecting,
    canEnable: decision.canEnable,
    canDisable: decision.canDisable,
    pending: actions.pending,
    failed: actions.failed,
    invitation:
      decision.visible &&
      decision.canEnable &&
      decision.state === 'off' &&
      local.snapshot.permission === 'default' &&
      !local.seen,
    enable: actions.enable,
    disable: actions.disable,
    dismissInvitation: local.markSeen,
  };
}
