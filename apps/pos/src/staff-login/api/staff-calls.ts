import {
  signOutResult,
  type ChangeTemporaryStaffPinInput,
  type StaffOtpRequestInput,
  type StaffOtpVerifyInput,
  type StaffPinInput,
  type StaffPinResetOtpInput,
  type StaffPinResetRequestInput,
  type StaffSessionContext,
} from '@pospay/contracts';
import { staffApiClient } from '@/shared/api/client';

/** نتيجة الدخول بالرقم السري: جلسة، أو رفض مؤقت بمدّة أو بتغيير مطلوب، أو رفض عام. */
export type StaffPinSignInOutcome =
  | StaffSessionContext
  | { readonly kind: 'change_required'; readonly proof: string }
  | { readonly kind: 'expired' }
  | null;

/** نتيجة تغيير الرقم السري المؤقت: اتحفظ، خلصت مدته، اتقفل، أو رفض. */
export type StaffPinChangeOutcome = 'changed' | 'expired' | 'locked' | 'invalid';

export async function requestStaffCode(input: StaffOtpRequestInput) {
  const response = await staffApiClient().POST('/v1/devices/me/staff-otp/request', { body: input });
  if (response.data !== undefined)
    return { kind: 'accepted' as const, acknowledgement: response.data };
  return { kind: 'refused' as const, code: response.error?.code ?? 'OTP_UNAVAILABLE' };
}

export async function verifyStaffCode(input: StaffOtpVerifyInput) {
  const response = await staffApiClient().POST('/v1/devices/me/staff-otp/verify', { body: input });
  return response.data ?? null;
}

export async function signInStaffPin(input: StaffPinInput): Promise<StaffPinSignInOutcome> {
  const response = await staffApiClient().POST('/v1/devices/me/staff-pin/sign-in', { body: input });
  if (response.data !== undefined) return response.data;
  const code = response.error?.code;
  if (code === 'PIN_EXPIRED') return { kind: 'expired' };
  if (code === 'PIN_CHANGE_REQUIRED') {
    // الدليل جاي مع رفض 403 في details؛ من غير طول كافٍ مش بيتقبلش كدليل.
    const proof = (response.error?.details as { proof?: unknown } | undefined)?.proof;
    if (typeof proof === 'string' && proof.length >= 16) return { kind: 'change_required', proof };
  }
  return null;
}

export async function changeTemporaryStaffPin(
  input: ChangeTemporaryStaffPinInput,
): Promise<StaffPinChangeOutcome> {
  const response = await staffApiClient().POST('/v1/devices/me/staff-pin/change', { body: input });
  if (response.response.ok) return 'changed';
  if (response.error?.code === 'PIN_EXPIRED') return 'expired';
  if (response.error?.code === 'PIN_LOCKED') return 'locked';
  return 'invalid';
}

/** نتيجة طلب كود استرجاع الرقم السري: اتقبل (الرد واحد لأي معرّف)، القناة مقفولة، حد معدّل، أو رفض. */
export type StaffPinResetRequestOutcome =
  | { readonly kind: 'accepted'; readonly challengeId: string }
  | { readonly kind: 'unavailable' | 'limited' | 'refused' };

/** نتيجة تعيين الرقم السري بالكود: اتغيّر، الكود غلط أو خلص، حد معدّل، القناة مقفولة، أو رفض عام. */
export type StaffPinResetOutcome = 'reset' | 'invalid' | 'limited' | 'unavailable' | 'refused';

export async function requestStaffPinReset(
  input: StaffPinResetRequestInput,
): Promise<StaffPinResetRequestOutcome> {
  const response = await staffApiClient().POST('/v1/devices/me/staff-pin/otp/request', {
    body: input,
  });
  if (response.data !== undefined)
    return { kind: 'accepted', challengeId: response.data.challenge_id };
  const code = response.error?.code;
  if (code === 'OTP_UNAVAILABLE') return { kind: 'unavailable' };
  if (code === 'TOO_MANY_REQUESTS') return { kind: 'limited' };
  return { kind: 'refused' };
}

export async function resetStaffPinWithOtp(
  input: StaffPinResetOtpInput,
): Promise<StaffPinResetOutcome> {
  const response = await staffApiClient().POST('/v1/devices/me/staff-pin/otp/reset', {
    body: input,
  });
  if (response.response.ok) return 'reset';
  const code = response.error?.code;
  if (code === 'TOO_MANY_REQUESTS') return 'limited';
  if (code === 'OTP_UNAVAILABLE') return 'unavailable';
  if (code === 'OTP_INVALID') return 'invalid';
  return 'refused';
}

export async function probeStaffSessionWithStatus() {
  const response = await staffApiClient().GET('/v1/devices/me/staff-session');
  if (response.response.status === 401) return { kind: 'unauthenticated' as const };
  if ([403, 404].includes(response.response.status)) return { kind: 'refused' as const };
  if (response.data === undefined) {
    // 200 بجسم فارغ أو غير مقروء: الاسترداد يعامله كحمولة غير صالحة ويمسح الجلسة، والـ poll يفضل يرمي.
    if (response.response.ok) return { kind: 'invalid' as const };
    throw new Error('STAFF_SESSION_UNAVAILABLE');
  }
  return { kind: 'ok' as const, data: response.data };
}

export async function probeStaffSession() {
  const outcome = await probeStaffSessionWithStatus();
  if (outcome.kind === 'invalid') throw new Error('STAFF_SESSION_UNAVAILABLE');
  return outcome.kind === 'ok' ? outcome.data : null;
}

export async function signOutStaff() {
  const response = await staffApiClient().POST('/v1/devices/me/staff-session/sign-out');
  if (!response.response.ok) throw new Error('STAFF_SIGN_OUT_REFUSED');
  // جواب غامض (200 من غير حالة معروفة) يوقف المتصل؛ مينفعش يعدّ نفسه خرج.
  if (!signOutResult.safeParse(response.data).success) throw new Error('STAFF_SIGN_OUT_UNCLEAR');
}
