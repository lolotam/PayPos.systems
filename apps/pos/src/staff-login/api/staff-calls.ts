import {
  signOutResult,
  type StaffOtpRequestInput,
  type StaffOtpVerifyInput,
  type StaffPinInput,
} from '@pospay/contracts';
import { staffApiClient } from '@/shared/api/client';

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

export async function signInStaffPin(input: StaffPinInput) {
  const response = await staffApiClient().POST('/v1/devices/me/staff-pin/sign-in', { body: input });
  return response.data ?? null;
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
