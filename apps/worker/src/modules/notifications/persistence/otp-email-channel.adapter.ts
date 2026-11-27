import {
  PASSWORD_RESET_OTP_KEY,
  PASSWORD_RESET_OTP_REVISION,
  STAFF_PIN_RESET_OTP_KEY,
  STAFF_PIN_RESET_OTP_REVISION,
} from '@pospay/notifications';
import type { Channel, EmailRequest } from '@pospay/notifications';
import type { OtpChannel, OtpPending, OtpWorkerCapability } from '../ports/otp-execution.port.ts';

/** مزوّد بصمة معرّف رسالة المزود — بصمة مش بتاخد المعرّف الخام. */
export type ProviderIdentity = (providerMessageId: string) => Uint8Array;

/**
 * قناة الإرسال بالإيميل لاعتماد الاسترجاع: القالب المعتمد، والرمز في ذاكرة واحدة،
 * والوسوم بتربط الرسالة بسجل الاعتماد عشان ردّ المزود يوصل للمحل الصح.
 *
 * @param channel قناة Resend
 * @param capability جاهزية قناة الإيميل
 * @param providerIdentity بصمة معرّف رسالة المزود
 * @param now ساعة العملية
 * @returns قناة إيميل لعامل الاعتماد
 */
export function createEmailOtpChannel(
  channel: Channel<EmailRequest>,
  capability: OtpWorkerCapability,
  providerIdentity: ProviderIdentity,
  now: () => Date,
): OtpChannel {
  return {
    channel: 'EMAIL',
    // بريد الاعتماد مالوش اسم قالب المزوّد: القالب بتاعنا إحنا، والمزوّد بياخد HTML.
    valid: (attempt: OtpPending) =>
      attempt.providerTemplateName === null &&
      [PASSWORD_RESET_OTP_KEY, STAFF_PIN_RESET_OTP_KEY].includes(attempt.templateKey),
    send: async (attempt, material) => {
      if (now() >= material.deadline || !(await capability.ready()))
        return { status: 'FAILED', failureCode: 'CONFIG_INVALID', outcomeKnown: true };
      const result = await channel.send({
        email: material.destination,
        locale: attempt.locale,
        // القالب من سجل المحاولة نفسه: اعتماد الرقم السري ليه نص غير نص كلمة المرور.
        templateKey: attempt.templateKey,
        templateRevision:
          attempt.templateKey === STAFF_PIN_RESET_OTP_KEY
            ? STAFF_PIN_RESET_OTP_REVISION
            : PASSWORD_RESET_OTP_REVISION,
        safeParameters: [material.code],
        attemptId: attempt.id,
        executionId: material.executionId,
        deadline: material.deadline,
        authChallengeId: attempt.challengeId,
      });
      if (result.kind === 'accepted')
        return {
          status: 'SENT',
          failureCode: 'PROVIDER_ACCEPTED',
          outcomeKnown: true,
          providerMessageDigest: providerIdentity(result.providerMessageId),
        };
      if (result.kind === 'expired')
        return { status: 'EXPIRED', failureCode: 'CHALLENGE_INVALID', outcomeKnown: true };
      if (result.kind === 'refused')
        return { status: 'FAILED', failureCode: 'CONFIG_INVALID', outcomeKnown: true };
      return {
        status: 'FAILED',
        failureCode: result.kind === 'rejected' ? 'PROVIDER_REJECTED' : 'PROVIDER_UNKNOWN',
        outcomeKnown: result.kind === 'rejected',
      };
    },
  };
}
