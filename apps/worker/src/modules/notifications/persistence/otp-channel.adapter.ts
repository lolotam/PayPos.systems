import {
  prepareStaffOtp,
  type Channel,
  type OtpTemplateApproval,
  type createProviderMessageDigest,
} from '@pospay/notifications';
import type { OtpChannel, OtpPending, OtpWorkerCapability } from '../ports/otp-execution.port.ts';

export function createOtpChannel(
  channel: Channel,
  approval: OtpTemplateApproval,
  capability: OtpWorkerCapability,
  providerIdentity: ReturnType<typeof createProviderMessageDigest>,
  now: () => Date,
): OtpChannel {
  return {
    valid: (attempt: OtpPending) => attempt.providerTemplateName === approval.names[attempt.locale],
    send: async (attempt, material) => {
      if (attempt.providerTemplateName === null)
        return { status: 'FAILED', failureCode: 'CONFIG_INVALID', outcomeKnown: true };
      const prepared = prepareStaffOtp(
        approval,
        attempt.locale,
        attempt.providerTemplateName,
        material.code,
      );
      if (
        prepared === null ||
        now() >= material.deadline ||
        !(await capability.ready()) ||
        now() >= material.deadline
      )
        return { status: 'FAILED', failureCode: 'CONFIG_INVALID', outcomeKnown: true };
      const result = await channel.send({
        phone: material.phone,
        locale: attempt.locale,
        deadline: material.deadline,
        providerTemplateName: prepared.name,
        components: prepared.components,
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
