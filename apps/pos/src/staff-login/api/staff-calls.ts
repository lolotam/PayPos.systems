import {
  signOutResult,
  type ChangeTemporaryStaffPinInput,
  type StaffOtpRequestInput,
  type StaffOtpVerifyInput,
  type StaffPinInput,
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

export async function probeStaffSession() {
  const response = await staffApiClient().GET('/v1/devices/me/staff-session');
  if ([401, 403, 404].includes(response.response.status)) return null;
  if (response.data === undefined) throw new Error('STAFF_SESSION_UNAVAILABLE');
  return response.data;
}

export async function signOutStaff() {
  const response = await staffApiClient().POST('/v1/devices/me/staff-session/sign-out');
  if (!response.response.ok) throw new Error('STAFF_SIGN_OUT_REFUSED');
  // جواب غامض (200 من غير حالة معروفة) يوقف المتصل؛ مينفعش يعدّ نفسه خرج.
  if (!signOutResult.safeParse(response.data).success) throw new Error('STAFF_SIGN_OUT_UNCLEAR');
}
