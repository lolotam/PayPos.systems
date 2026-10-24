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
}

/** الحالة اللي بتتعرض، والمؤشرات اللي بتعدّلها. */
export interface PushStateDecision {
  state: PushControlState;
  visible: boolean;
  storageBlocked: boolean;
  offline: boolean;
  reconnecting: boolean;
}

/**
 * بتقرّر حالة الزر: واحدة من الخمسة، مع المؤشرات (بلا نت، بتتصل تاني، التخزين متعطل).
 * "مفعّل" يعني إن في سجل لنفس الشركة والسجل مش معلّق والسماح مُتاح والاشتراك موجود في المتصفح.
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
  if (input.notReady) return { state: 'off', visible: false, ...modifiers };
  if (input.storageBlocked) {
    return { state: 'unsupported', visible: true, ...modifiers };
  }
  if (!input.supported) {
    return {
      state: input.installFirst ? 'install-first' : 'unsupported',
      visible: true,
      ...modifiers,
    };
  }
  if (input.permission === 'denied') {
    return { state: 'blocked', visible: true, ...modifiers };
  }
  const on =
    input.record !== null &&
    input.record.company_id === input.companyId &&
    !input.record.suspended &&
    input.permission === 'granted' &&
    input.browserSubscribed;
  return {
    state: on ? 'on' : 'off',
    visible: true,
    ...modifiers,
    reconnecting: modifiers.reconnecting && !on,
  };
}
