import { useCallback, useState } from 'react';

import { t } from '@pospay/i18n';

import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { useLocale } from '@/shared/locale/locale-context';

import { DeviceScreen } from './device-screen';
import {
  connectEmployee,
  readDeviceRole,
  readRememberedBusiness,
  rememberBusiness,
  saveDeviceRole,
  type DeviceRole,
} from './device-role';
import { LoadingNotice } from './loading-notice';
import type { PersonalWorkspace } from './manager-link';
import { PasteLinkForm } from './paste-link-form';
import { StartScreen } from './start-screen';
import { useNativeLink } from './use-native-link';

type StartAlert = 'saveFailed' | 'needsInternet' | 'linkRequired';
type FlowAlert = 'linkRequired' | 'otherBusiness' | 'counterDevice';

type NativeState =
  | { kind: 'loading' }
  | { kind: 'start'; business: PersonalWorkspace | null; alert?: StartAlert }
  | { kind: 'flow'; role: DeviceRole; business: PersonalWorkspace | null; alert?: FlowAlert };

const FLOW_ALERT_KEYS = {
  linkRequired: 'personalStaff.linkRequired',
  otherBusiness: 'nativeShell.otherBusiness',
  counterDevice: 'nativeShell.counterDevice',
} as const;

/**
 * لينك مش مقبول: حاجة واحدة بس بتتغير، وهي الرسالة (FR-012).
 *
 * @param role    الدور المحفوظ على الجهاز
 * @param business النشاط المتذكر على الجهاز
 * @returns حالة الشاشة بعد رفض اللينك
 */
function withLinkRequired(
  role: DeviceRole | null,
  business: PersonalWorkspace | null,
): NativeState {
  if (role === null) return { kind: 'start', business, alert: 'linkRequired' };
  return { kind: 'flow', role, business, alert: 'linkRequired' };
}

/**
 * قواعد تطبيق لينك المدير — نفس القواعد في كل الحالات: التشغيل البارد، والتشغيل الدافي،
 * واللصق في شاشة الموظفة (FR-012).
 *
 * @param role     الدور المحفوظ على الجهاز
 * @param business النشاط المتذكر على الجهاز
 * @param workspace النشاط اللي جاي في اللينك
 * @returns حالة الشاشة بعد تطبيق اللينك
 */
async function stateAfterLink(
  role: DeviceRole | null,
  business: PersonalWorkspace | null,
  workspace: PersonalWorkspace,
): Promise<NativeState> {
  if (role === 'counter') {
    // جهاز الكاونتر ما بيبدّلش دوره من لينك؛ تغيير الدور محتاج تأكيد FR-008 وهو Part B.
    return { kind: 'flow', role: 'counter', business: null, alert: 'counterDevice' };
  }
  if (role === null) {
    // من غير نت مفيش حاجة تتحفظ: اللينك بيرفض زي باقي أول تشغيل (FR-012).
    if (!navigator.onLine) return { kind: 'start', business: null, alert: 'needsInternet' };
    await connectEmployee(workspace);
    return { kind: 'flow', role: 'employee', business: workspace };
  }
  if (business === null) {
    await rememberBusiness(workspace);
    return { kind: 'flow', role: 'employee', business: workspace };
  }
  const same =
    business.company_id === workspace.company_id && business.business_id === workspace.business_id;
  if (same) return { kind: 'flow', role: 'employee', business };
  // نشاط تاني والموظفة ممكن تكون داخل جلسة: التغيير محتاج تأكيد FR-008، وده Part B.
  return { kind: 'flow', role: 'employee', business, alert: 'otherBusiness' };
}

export function NativeEntry() {
  const locale = useLocale();
  const [state, setState] = useState<NativeState>({ kind: 'loading' });

  const onStart = useCallback((role: DeviceRole | null, business: PersonalWorkspace | null) => {
    setState(role === null ? { kind: 'start', business } : { kind: 'flow', role, business });
  }, []);

  const onLink = useCallback(async (workspace: PersonalWorkspace | null) => {
    try {
      const [role, business] = await Promise.all([readDeviceRole(), readRememberedBusiness()]);
      setState(
        workspace === null
          ? withLinkRequired(role, business)
          : await stateAfterLink(role, business, workspace),
      );
    } catch {
      // تخزين غير مقروء أو كتابة فاشلة: نرجع لشاشة البداية بدل ما نسيب الشاشة نص نص.
      setState({ kind: 'start', business: null });
    }
  }, []);

  useNativeLink(onStart, onLink);

  const choose = (role: DeviceRole) => {
    // من غير نت مفيش حاجة تتحفظ (حالة «أول تشغيل من غير نت» في spec 065): اختيار متحفظ
    // هيفتح الشاشة اللي مش هتوصل للخادم.
    if (!navigator.onLine) {
      setState({ kind: 'start', business: state.business, alert: 'needsInternet' });
      return;
    }
    void saveDeviceRole(role).then(
      () => setState({ kind: 'flow', role, business: state.business }),
      () => setState({ kind: 'start', business: state.business, alert: 'saveFailed' }),
    );
  };

  if (state.kind === 'loading') return <LoadingNotice />;
  if (state.kind === 'flow') {
    const alertText = state.alert ? t(locale, FLOW_ALERT_KEYS[state.alert]) : null;
    return (
      <>
        {alertText ? (
          <p
            role="alert"
            className="mx-auto mt-4 w-full max-w-md bg-destructive/10 px-4 py-3 text-center text-destructive"
          >
            {alertText}
          </p>
        ) : null}
        {state.role === 'counter' ? (
          <DeviceScreen />
        ) : (
          <PersonalScreen
            workspace={state.business ?? undefined}
            connect={<PasteLinkForm onConnect={(workspace) => void onLink(workspace)} />}
          />
        )}
      </>
    );
  }
  return <StartScreen onChoose={choose} alert={state.alert} />;
}
