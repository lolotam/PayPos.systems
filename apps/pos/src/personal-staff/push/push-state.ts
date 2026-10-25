import type { PushPermission } from './push-browser';
import type { PushRecord } from './push-record';

/** الحالات الخمسة للزر، واحدة بس في نفس الوقت (FR-010). */
export type PushControlState = 'unsupported' | 'install-first' | 'blocked' | 'off' | 'on';

/** كل اللي بتحدّد حالة الزر وModifires بتاعتها. */
export interface PushStateInput {
  notReady: boolean;
  storageBlocked: boolean;
  supported: boolean;
  installFirst: boolean;
  permission: PushPermission;
  online: boolean;
  record: PushRecord | null;
  companyId: string;
  browserSubscribed: boolean;
  reconnecting: boolean;
  /** هل المتصفح يقدر يشغّل الإشعارات: محتاج قفل حقيقي بين التبويبات. */
  canEnable: boolean;
  /** قراءة السجل فشلت: السجل مش معروف، فمفيش حاجة نعدّلها. */
  recordReadFailed: boolean;
}

/** الحالة اللي بتتعرض، والمؤشرات اللي بتعدّلها. */
export interface PushStateDecision {
  state: PushControlState;
  visible: boolean;
  storageBlocked: boolean;
  offline: boolean;
  reconnecting: boolean;
  /** هل المتصفح يقدر يشغّل الإشعارات (محتاج قفل حقيقي بين التبويبات). */
  canEnable: boolean;
  /** هل في إشعار من الشركة دي يتقفل: زرار الإيقاف يفضل متاح دايماً. */
  canDisable: boolean;
}

/**
 * بتقرّر حالة الزر: واحدة من الخمسة، مع المؤشرات (بلا نت، بتتصل تاني، التخزين متعطل).
 * "مفعّل" يعني إن في سجل لنفس الشركة والسجل مش معلّق والسماح مُتاح والاشتراك موجود في المتصفح.
 * الحالة دي بتقول الحقيقة دايماً؛ الإلغاء (canDisable) قرار لوحده عشان يفضل متاح على
 * الموبايل المشترك مهما كان القفل ولا الإذن. ومتصفح من غير قفل بين التبويبات ما يقدرش
 * يشغّل الإشعارات (ADR-0052 §7). وقراءة السجل الفاشلة معناها إن السجل مش معروف، فمفيش
 * حاجة تتقفل.
 *
 * @param input كل الوقائع المعروفة عن الجهاز والسجل
 * @returns الحالة المعروضة والمؤشرات
 */
export function decidePushState(input: PushStateInput): PushStateDecision {
  const offline = !input.online;
  // "بنتصل تاني" بتخص السجل المعلّق للشركة اللي في الجلسة بس؛ سجل شركة تانية
  // بيعرض "مقفول" عادي، لأن الموظفة غيرت الشركة (WP-Q4).
  const ownSuspended =
    input.record !== null && input.record.suspended && input.record.company_id === input.companyId;
  const modifiers = {
    storageBlocked: input.storageBlocked,
    offline,
    reconnecting: input.reconnecting && ownSuspended,
  };
  // الإلغاء قرار لوحده: الموبايل المشترك لازم يقدر يوقّف الإشعارات دايماً، من غير ما
  // القفل ولا الإذن يمنع. بس قراءة فاشلة معناها إننا مش عارفين السجل، فمفيش حاجة
  // من الشركة دي تتقفل.
  const usable = !input.notReady && !input.storageBlocked && !input.installFirst && input.supported;
  const holdsOwn =
    (input.record !== null && input.record.company_id === input.companyId) ||
    (!input.recordReadFailed && input.record === null && input.browserSubscribed);
  const canDisable = usable && !input.recordReadFailed && holdsOwn;
  const common = { ...modifiers, canEnable: input.canEnable };
  if (input.notReady) {
    return { state: 'off', visible: false, ...common, canDisable: false };
  }
  if (input.storageBlocked) {
    return { state: 'unsupported', visible: true, ...common, canDisable: false };
  }
  // الآيفون في تاب مش مثبّت: الإشعارات مش بتشتغل أصلاً، فبنشرح الخطوة بدل زرار ميت (WP-Q3).
  if (input.installFirst) {
    return { state: 'install-first', visible: true, ...common, canDisable: false };
  }
  if (!input.supported) {
    return { state: 'unsupported', visible: true, ...common, canDisable: false };
  }
  if (input.permission === 'denied') {
    return { state: 'blocked', visible: true, ...common, canDisable };
  }
  const on =
    input.record !== null &&
    input.record.company_id === input.companyId &&
    !input.record.suspended &&
    input.permission === 'granted' &&
    input.browserSubscribed;
  const decision: PushStateDecision = {
    state: on ? 'on' : 'off',
    visible: true,
    ...common,
    reconnecting: modifiers.reconnecting && !on,
    canDisable,
  };
  // متصفح من غير قفل ما فيش تشغيل، فلو مفيش حاجة تتقفل برضه بنقول "مش داعم" بدل
  // زرار تشغيل هي فشل في كل ضغطة.
  if (!input.canEnable && decision.state === 'off' && !canDisable) {
    return { ...decision, state: 'unsupported' };
  }
  return decision;
}
