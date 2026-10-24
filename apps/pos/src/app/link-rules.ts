import type { SwitchOutcome } from './business-switch';
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

/** تنبيهات شاشة الموظفة: لينك مش مقبول، أو جهاز كاونتر، أو حفظ فشل، أو نت، أو تبديل نشاط. */
export type FlowAlert =
  | 'linkRequired'
  | 'counterDevice'
  | 'saveFailed'
  | 'needsInternet'
  | 'roleChangeOffline'
  | 'roleChangeFailed';

/**
 * حالة التطبيق: لسه بيقرا، أو شاشة البداية، أو شاشة الموظفة/الكاونتر.
 *
 * الـ pending هو النشاط الجديد اللي في لينك تاني: الشاشة بتفضل على النشاط
 * الحالي لحد ما الموظفة تأكد التبديل.
 */
export type NativeState =
  | { kind: 'loading' }
  | { kind: 'start'; business: PersonalWorkspace | null; alert?: StartAlert }
  | {
      kind: 'flow';
      role: DeviceRole;
      business: PersonalWorkspace | null;
      pending?: PersonalWorkspace;
      alert?: FlowAlert;
    };

/** نتيجة تطبيق لينك: شاشة جاهزة، أو فشل الحفظ مع الدور والنشاط اللي اتقروا. */
export type LinkOutcome =
  | { kind: 'state'; state: NativeState }
  | { kind: 'failed'; role: DeviceRole | null; business: PersonalWorkspace | null };

export const FLOW_ALERT_KEYS = {
  linkRequired: 'personalStaff.linkRequired',
  counterDevice: 'nativeShell.counterDevice',
  saveFailed: 'nativeShell.saveFailed',
  needsInternet: 'nativeShell.needsInternet',
  roleChangeOffline: 'nativeShell.roleChangeOffline',
  roleChangeFailed: 'nativeShell.roleChangeFailed',
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
  // نشاط تاني: الشاشة بتفضل على النشاط الحالي، والتبديل محتاج تأكيد الموظفة (FR-012).
  return { kind: 'flow', role: 'employee', business, pending: workspace };
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
 * حالة الشاشة بعد نتيجة لينك: الشاشة الجديدة، أو فشل الحفظ مع اللي اتقروا.
 *
 * @param current حالة الشاشة الحالية
 * @param outcome نتيجة تطبيق اللينك
 * @returns حالة الشاشة بعد اللينك
 */
export function stateFromLink(current: NativeState, outcome: LinkOutcome): NativeState {
  if (outcome.kind === 'state') return outcome.state;
  return stateAfterFailure(current, outcome.role, outcome.business);
}

/**
 * حالة الشاشة بعد تبديل النشاط.
 *
 * النجاح: النشاط الجديد هو المعروض. الفشل: النشاط القديم يفضل زي ما هو
 * والانتظار بيتبعت، عشان الموظفة تعرف إن مفيش حاجة اتغيرت وتقدر تعيد المحاولة.
 *
 * @param current حالة الشاشة الحالية
 * @param outcome نتيجة التبديل
 * @param pending النشاط الجديد
 * @returns حالة الشاشة بعد التبديل
 */
export function stateAfterSwitch(
  current: NativeState,
  outcome: SwitchOutcome,
  pending: PersonalWorkspace,
): NativeState {
  if (current.kind !== 'flow') return current;
  if (outcome === 'switched') return { kind: 'flow', role: current.role, business: pending };
  const alert = outcome === 'offline' ? 'roleChangeOffline' : 'roleChangeFailed';
  return { kind: 'flow', role: current.role, business: current.business, pending, alert };
}

/**
 * حالة الشاشة بعد إلغاء تبديل النشاط: النشاط القديم والجلسة زي ما هما.
 * رسالتا الرفض والانقطاع تخصّان التبديل اللي اتلغى، فبتختفي معاه وأي تنبيه تاني بيفضل.
 *
 * @param current حالة الشاشة الحالية
 * @returns حالة الشاشة بعد الإلغاء
 */
export function stateWithoutPending(current: NativeState): NativeState {
  if (current.kind !== 'flow' || current.pending === undefined) return current;
  if (
    current.alert === 'roleChangeFailed' ||
    current.alert === 'roleChangeOffline' ||
    current.alert === undefined
  ) {
    return { kind: 'flow', role: current.role, business: current.business };
  }
  return { kind: 'flow', role: current.role, business: current.business, alert: current.alert };
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
