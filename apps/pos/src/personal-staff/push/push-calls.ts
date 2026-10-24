import createClient from 'openapi-fetch';
import type { PushConfig, PushRevokeInput, PushSubscriptionInput } from '@pospay/contracts';

import { apiOrigin } from '@/shared/api/origin';
import type { paths } from '@/shared/api/schema';

// نفس إعدادات عميل المسارات الشخصية: كوكيز من غير مفتاح جهاز، ومن غير تخزين مؤقت (ADR-0027).
const client = () =>
  createClient<paths>({ baseUrl: apiOrigin(), credentials: 'include', cache: 'no-store' });

/** خطأ من مسارات الإشعارات، والكود بتاعه هو اللي الـ API رجعه. */
export class PushApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PushApiError';
  }
}

/** المفتاح اتغيّر بعد ما المتصفح جاب المفتاح العام: التسجيل مرفوض والتطبيق يجيب المفتاح الجديد. */
export class PushKeyStaleError extends PushApiError {
  constructor() {
    super('PUSH_KEY_STALE');
    this.name = 'PushKeyStaleError';
  }
}

/** جواب المسار: جاهز بالمفتاح، أو مش جاهز (الخدمة مش مهيأة). */
export type PushConfigResult = { kind: 'ready'; config: PushConfig } | { kind: 'not-ready' };

function errorCode(error: { code?: string } | undefined): string | undefined {
  return error?.code;
}

/**
 * مهلة على الطلب: الشبكة واقفة ما تعلّقش الواجهة ولا تسجيل الخروج.
 *
 * @param promise الطلب اللي هيتبعت
 * @param ms    المهلة بالميلي ثانية
 * @returns نتيجة الطلب أو رفض بمهلة
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new PushApiError('PUSH_TIMEOUT')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        window.clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

export const pushCalls = {
  config: async (): Promise<PushConfigResult> => {
    const result = await client().GET('/v1/staff/push/config');
    if (result.data !== undefined) return { kind: 'ready', config: result.data };
    const code = errorCode(result.error);
    if (code === 'NOT_READY' || result.response.status === 503) return { kind: 'not-ready' };
    throw new PushApiError(code ?? 'PUSH_CONFIG_REFUSED');
  },
  register: async (input: PushSubscriptionInput): Promise<void> => {
    // الحقل الاختياري في العقد بيسمح بـ undefined، لكن جسم الطلب المولّد ما بيقبلش غير
    // رقم أو null، فبنبعته null بدل ما نسيبه (exactOptionalPropertyTypes).
    const body = {
      ...input,
      subscription: {
        ...input.subscription,
        expirationTime: input.subscription.expirationTime ?? null,
      },
    };
    const result = await client().PUT('/v1/staff/push/subscription', { body });
    if (result.response.ok) return;
    const code = errorCode(result.error);
    if (code === 'PUSH_KEY_STALE') throw new PushKeyStaleError();
    throw new PushApiError(code ?? 'PUSH_SUBSCRIPTION_REFUSED');
  },
  revoke: async (installationId: string): Promise<void> => {
    const body: PushRevokeInput = { installation_id: installationId };
    const result = await client().POST('/v1/staff/push/subscription/revoke', { body });
    if (result.response.ok) return;
    throw new PushApiError(errorCode(result.error) ?? 'PUSH_REVOKE_REFUSED');
  },
};
