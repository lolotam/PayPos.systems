import {
  connectEmployee,
  readDeviceRole,
  readRememberedBusiness,
  rememberBusiness,
  saveDeviceRole,
  type DeviceRole,
} from './device-role';
import type { PersonalWorkspace } from './manager-link';

/** تنبيهات شاشة البداية: حفظ فشل، أو نت، أو لينك مش مقبول. */
export type StartAlert = 'saveFailed' | 'needsInternet' | 'linkRequired';

/** تنبيهات شاشة الموظفة: لينك مش مقبول، أو نشاط تاني، أو جهاز كاونتر، أو حفظ فشل، أو نت. */
export type FlowAlert =
  'linkRequired' | 'otherBusiness' | 'counterDevice' | 'saveFailed' | 'needsInternet';

/** حالة التطبيق: لسه بيقرا، أو شاشة البداية، أو شاشة الموظفة/الكاونتر. */
export type NativeState =
  | { kind: 'loading' }
  | { kind: 'start'; business: PersonalWorkspace | null; alert?: StartAlert }
  | { kind: 'flow'; role: DeviceRole; business: PersonalWorkspace | null; alert?: FlowAlert };

/** نتيجة تطبيق لينك: شاشة جاهزة، أو فشل الحفظ مع الدور والنشاط اللي اتقروا. */
export type LinkOutcome =
  | { kind: 'state'; state: NativeState }
  | { kind: 'failed'; role: DeviceRole | null; business: PersonalWorkspace | null };

export const FLOW_ALERT_KEYS = {
  linkRequired: 'personalStaff.linkRequired',
  otherBusiness: 'nativeShell.otherBusiness',
  counterDevice: 'nativeShell.counterDevice',
  saveFailed: 'nativeShell.saveFailed',
  needsInternet: 'nativeShell.needsInternet',
} as const;

/**
 * حالة الشاشة لما التطبيق يفتح من غير لينك: دور محفوظ ولا أول تشغيل.
 *
 * @param role     الدور المحفوظ على الجهاز
 * @param business النشاط المتذكر على الجهاز
 * @returns حالة الشاشة
 */
export function stateForRole(
  role: DeviceRole | null,
  business: PersonalWorkspace | null,
): NativeState {
  return role === null ? { kind: 'start', business } : { kind: 'flow', role, business };
}

/**
 * لينك مش مقبول: الموظفة من غير نشاط متذكر بتشوف سطر «اطلب من المدير» في شاشتها،
 * فمفيش رسالة تانية فوقه (FR-012).
 *
 * @param role     الدور المحفوظ على الجهاز
 * @param business النشاط المتذكر على الجهاز
 * @returns حالة الشاشة بعد رفض اللينك
 */
export function withLinkRequired(
  role: DeviceRole | null,
  business: PersonalWorkspace | null,
): NativeState {
  if (role === null) return { kind: 'start', business, alert: 'linkRequired' };
  if (role === 'employee' && business === null) return { kind: 'flow', role, business };
  return { kind: 'flow', role, business, alert: 'linkRequired' };
}

/**
 * قواعد تطبيق لينك المدير — نفس القواعد في كل الحالات: التشغيل البارد، والتشغيل الدافي،
 * واللصق في شاشة الموظفة (FR-012).
 *
 * @param role      الدور المحفوظ على الجهاز
 * @param business  النشاط المتذكر على الجهاز
 * @param workspace النشاط اللي جاي في اللينك
 * @returns حالة الشاشة بعد تطبيق اللينك
 */
export async function stateAfterLink(
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
    // من غير نت مفيش حاجة تتحفظ: الموظفة ما بتتربطش بنشاط من غير نت (FR-012).
    if (!navigator.onLine) {
      return { kind: 'flow', role: 'employee', business: null, alert: 'needsInternet' };
    }
    await rememberBusiness(workspace);
    return { kind: 'flow', role: 'employee', business: workspace };
  }
  const same =
    business.company_id === workspace.company_id && business.business_id === workspace.business_id;
  if (same) return { kind: 'flow', role: 'employee', business };
  // نشاط تاني والموظفة ممكن تكون داخل جلسة: التغيير محتاج تأكيد FR-008، وده Part B.
  return { kind: 'flow', role: 'employee', business, alert: 'otherBusiness' };
}

/**
 * الحفظ فشل: الجهاز اللي دوره محفوظ يفضل على شاشته، واللي من غير دور يرجع لشاشة البداية.
 *
 * @param current  حالة الشاشة الحالية
 * @param role     الدور المحفوظ على الجهاز
 * @param business النشاط المتذكر على الجهاز
 * @returns حالة الشاشة بعد فشل الحفظ
 */
export function stateAfterFailure(
  current: NativeState,
  role: DeviceRole | null,
  business: PersonalWorkspace | null,
): NativeState {
  if (current.kind === 'flow') return { ...current, alert: 'saveFailed' };
  if (role === null) return { kind: 'start', business: null, alert: 'saveFailed' };
  return { kind: 'flow', role, business, alert: 'saveFailed' };
}

/**
 * حالة الشاشة بعد تطبيق لينك: بتقرا الدور والنشاط من التخزين وبتقرر.
 *
 * @param workspace النشاط اللي جاي في اللينك، أو null لو اللينك مش مقبول
 * @returns الشاشة بعد اللينك، أو فشل الحفظ مع الدور والنشاط اللي اتقروا
 */
export async function resolveLink(workspace: PersonalWorkspace | null): Promise<LinkOutcome> {
  const [role, business] = await Promise.all([readDeviceRole(), readRememberedBusiness()]);
  try {
    return {
      kind: 'state',
      state:
        workspace === null
          ? withLinkRequired(role, business)
          : await stateAfterLink(role, business, workspace),
    };
  } catch {
    return { kind: 'failed', role, business };
  }
}

/**
 * حالة الشاشة بعد اختيار نوع الجهاز.
 *
 * الاختيار بيقرا الدور المحفوظ من جديد الأول: لينك ممكن يكون وصل قبل الاختيار واتخزّن دور،
 * فالدور المحفوظ هو اللي بيتقدّم على الاختيار (BR-001).
 *
 * @param role الدور اللي اختارته الموظفة
 * @returns حالة الشاشة بعد الاختيار
 */
export async function resolveChoice(role: DeviceRole): Promise<NativeState> {
  const [stored, business] = await Promise.all([readDeviceRole(), readRememberedBusiness()]);
  if (stored !== null) return { kind: 'flow', role: stored, business };
  if (!navigator.onLine) return { kind: 'start', business: null, alert: 'needsInternet' };
  try {
    await saveDeviceRole(role);
    return { kind: 'flow', role, business };
  } catch {
    return { kind: 'start', business: null, alert: 'saveFailed' };
  }
}
