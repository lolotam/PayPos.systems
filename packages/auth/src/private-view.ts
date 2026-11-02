import { randomBytes } from 'node:crypto';
import type { AuthDatabase } from '@pospay/db';
import { verifyCashierPin } from './cashier-pin.ts';
import {
  closePrivateView,
  checkPrivateView,
  type PrivateViewCheckResult,
} from './private-view/check.ts';
import {
  openPrivateView,
  type PrivateViewOpenInput,
  type PrivateViewOpenResult,
} from './private-view/open.ts';
import type { PrivateViewEntropy, PrivateViewStoreOptions } from './private-view/options.ts';
import {
  mintPrivateViewProof,
  type PrivateViewProof,
  type PrivateViewScope,
} from './private-view/proof.ts';

export type { PrivateViewCheckResult } from './private-view/check.ts';
export type {
  PrivateViewExpired,
  PrivateViewMismatch,
  PrivateViewPassed,
} from './private-view/check.ts';
export type {
  PrivateViewOpened,
  PrivateViewOpenInput,
  PrivateViewOpenResult,
  PrivateViewRefused,
} from './private-view/open.ts';
export type { PrivateViewProof, PrivateViewScope } from './private-view/proof.ts';

/** مدخلات مقارنة PIN؛ النطاق يأتي من الجلسة التي تحقق منها الخادم. */
export interface PrivateViewPinInput {
  readonly pin: string;
  readonly hash: string | null;
  readonly scope: PrivateViewScope;
}

/** الجزء الذي يحتاجه المخزن من خيارات AuthOptions دون استيراد config وصنع دورة. */
export interface PrivateViewConfiguration {
  readonly clock?: {
    /** يعيد وقت الاعتماد الحالي للاختبار أو التشغيل. */
    now(): Date;
  };
  readonly entropy?: PrivateViewEntropy | undefined;
  readonly ids: {
    /** ينشئ معرّف صف verification الجديد. */
    newId(): string;
  };
}

/**
 * يركب مخزن النافذة الخاصة بافتراضيات التشغيل، مع إبقاء الساعة والعشوائية قابلين للضبط في الاختبار.
 *
 * @param options الساعة والعشوائية ومولد معرّفات الصفوف
 * @param database واجهة pospay_auth المحدودة
 * @returns واجهة إثبات PIN والفتح والفحص واللمس والقفل
 */
export function configuredPrivateView(
  options: PrivateViewConfiguration,
  database: AuthDatabase,
) {
  const store: PrivateViewStoreOptions = {
    database,
    ids: options.ids,
    entropy: options.entropy ?? { bytes: randomBytes },
    now: () => options.clock?.now() ?? new Date(),
  };
  return {
    provePin: async (input: PrivateViewPinInput): Promise<PrivateViewProof | null> => {
      if (!(await verifyCashierPin(input.pin, input.hash))) return null;
      return mintPrivateViewProof(input.scope, store.now());
    },
    open: (input: PrivateViewOpenInput): Promise<PrivateViewOpenResult> =>
      openPrivateView(store, input),
    check: (scope: PrivateViewScope, windowId: string): Promise<PrivateViewCheckResult> =>
      checkPrivateView(store, scope, windowId),
    close: (scope: PrivateViewScope, windowId: string): Promise<boolean> =>
      closePrivateView(store, scope, windowId),
  };
}

export type PrivateViewFacade = ReturnType<typeof configuredPrivateView>;
