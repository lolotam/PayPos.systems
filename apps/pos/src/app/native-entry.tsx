import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

import { DeviceScreen } from './device-screen';
import { EmployeeFlow } from './employee-flow';
import { FLOW_ALERT_KEYS } from './link-rules';
import { LoadingNotice } from './loading-notice';
import { MustUpdateScreen } from './min-version/must-update-screen';
import { useMinAppVersion } from './min-version/use-min-app-version';
import { PasteLinkForm } from './paste-link-form';
import { StartScreen } from './start-screen';
import { StartOverButton } from './start-over-button';
import { useNativeFlow } from './use-native-flow';
import { useNativeLink } from './use-native-link';

const ALERT_CLASS =
  'mx-auto mt-4 w-full max-w-md bg-destructive/10 px-4 py-3 text-center text-destructive';

/** تجميع الرجوع هنا بيخلي كل تدفق يقرر من حالته إمتى يعرضه من غير منطق مكرر. */
export function NativeEntry() {
  const locale = useLocale();
  const { state, busy, onStart, onLink, choose, startOver, confirm, cancel } = useNativeFlow();
  useNativeLink(onStart, onLink);
  const minVersion = useMinAppVersion();
  const back = <StartOverButton onStartOver={startOver} busy={busy} />;

  // فحص النسخة الدنيا بيغطي كل التدفقات: شاشة البداية، الكاونتر، والموظفة (FR-006).
  if (minVersion.checking) return <LoadingNotice />;
  if (minVersion.blocked) {
    return <MustUpdateScreen storeUrl={minVersion.storeUrl ?? ''} />;
  }
  if (state.kind === 'loading') return <LoadingNotice />;
  if (state.kind === 'flow') {
    const alertText = state.alert ? t(locale, FLOW_ALERT_KEYS[state.alert]) : null;
    const connect = <PasteLinkForm onConnect={(next) => void onLink(next)} locked={busy} />;
    // التنبيه بينزل جوه إطار الشاشة عشان يبقى فوق المحتوى مش فوق الصفحة كلها.
    const alertBanner = alertText ? (
      <p role="alert" className={ALERT_CLASS}>
        {alertText}
      </p>
    ) : undefined;
    return state.role === 'counter' ? (
      <DeviceScreen
        startOver={back}
        locked={busy}
        {...(alertBanner === undefined ? {} : { notice: alertBanner })}
      />
    ) : (
      <EmployeeFlow
        business={state.business}
        pending={state.pending ?? null}
        busy={busy}
        connect={connect}
        startOver={back}
        onConfirm={confirm}
        onCancel={cancel}
        {...(alertBanner === undefined ? {} : { notice: alertBanner })}
      />
    );
  }
  return state.alert === undefined ? (
    <StartScreen onChoose={choose} busy={busy} />
  ) : (
    <StartScreen onChoose={choose} alert={state.alert} busy={busy} />
  );
}
