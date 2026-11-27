import type { Locale, MessageKey } from '@pospay/i18n';

import { apiClient } from '@/shared/api/client';

/** نتيجة طلب الكود: مقبول (نفس الردّ لأي إيميل) أو رسالة خطأ. */
export type RequestCodeOutcome =
  | { readonly kind: 'accepted'; readonly challengeId: string; readonly retryAfter: number }
  | { readonly kind: 'error'; readonly key: MessageKey; readonly retryAfter?: number };

/** نتيجة تعيين كلمة المرور: تم، أو رسالة خطأ. */
export type ResetOutcome =
  { readonly kind: 'done' } | { readonly kind: 'error'; readonly key: MessageKey };

function failureKey(status: number): MessageKey {
  if (status === 429) return 'passwordReset.tooMany';
  if (status === 503) return 'passwordReset.unavailable';
  return 'admin.unexpected';
}

/** ثواني `Retry-After` من ردّ 429 لو رقم صحيح موجب؛ غير كده undefined (مش تاريخ HTTP ولا فاضي). */
function retryAfterSeconds(response: Response): number | undefined {
  if (response.status !== 429) return undefined;
  const value = response.headers.get('Retry-After');
  if (value === null || !/^\d{1,5}$/.test(value.trim())) return undefined;
  const seconds = Number(value);
  return seconds > 0 ? seconds : undefined;
}

function isInvalidCode(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'OTP_INVALID'
  );
}

/**
 * يطلب كود الاسترجاع على الإيميل. الردّ 202 موحّد: ما بيقولش لو الإيميل ليه حساب.
 *
 * @param email إيميل الحساب
 * @param locale لغة رسالة الكود
 * @returns قبول الطلب أو مفتاح رسالة الخطأ
 */
export async function requestPasswordResetCode(
  email: string,
  locale: Locale,
): Promise<RequestCodeOutcome> {
  try {
    const { data, response } = await apiClient().POST('/v1/auth/password-reset/otp/request', {
      body: { email, locale },
    });
    if (response.status === 202 && data !== undefined)
      return { kind: 'accepted', challengeId: data.challenge_id, retryAfter: data.retry_after };
    const retryAfter = retryAfterSeconds(response);
    return {
      kind: 'error',
      key: failureKey(response.status),
      ...(retryAfter === undefined ? {} : { retryAfter }),
    };
  } catch {
    return { kind: 'error', key: 'admin.unexpected' };
  }
}

/**
 * يعيّن كلمة المرور الجديدة بالكود. بعد النجاح كل الجلسات بتتقفل ومفيش جلسة جديدة بتتفتح.
 *
 * @param input الاعتماد والكود وكلمة المرور الجديدة
 * @param input.challengeId معرّف الاعتماد اللي رجع من طلب الكود
 * @param input.code الكود المكوّن من ٦ أرقام
 * @param input.newPassword كلمة المرور الجديدة
 * @returns نجاح التعيين أو مفتاح رسالة الخطأ
 */
export async function resetPasswordWithCode(input: {
  challengeId: string;
  code: string;
  newPassword: string;
}): Promise<ResetOutcome> {
  try {
    const { error, response } = await apiClient().POST('/v1/auth/password-reset/otp/reset', {
      body: {
        challenge_id: input.challengeId,
        code: input.code,
        new_password: input.newPassword,
      },
    });
    if (response.ok) return { kind: 'done' };
    if (isInvalidCode(error)) return { kind: 'error', key: 'passwordReset.invalidCode' };
    return { kind: 'error', key: failureKey(response.status) };
  } catch {
    return { kind: 'error', key: 'admin.unexpected' };
  }
}
