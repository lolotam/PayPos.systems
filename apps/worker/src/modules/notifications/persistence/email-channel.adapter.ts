import { renderOperationalEmail, type Channel, type EmailRequest } from '@pospay/notifications';
import { refusedResult, submissionResult } from '../domain/attempt-status.ts';
import type { ChannelPort, SendConfiguration } from '../ports/channel.port.ts';

export function createEmailChannelAdapter(
  channel: Channel<EmailRequest> | undefined,
): ChannelPort & SendConfiguration {
  const failure: SendConfiguration['failure'] = (attempt) => {
    if (channel === undefined) return 'CONFIG_INVALID';
    return renderOperationalEmail(
      attempt.templateKey,
      attempt.templateRevision,
      attempt.locale ?? '',
      attempt.safeParameters,
      'https://app.pospay.systems',
    ) === null
      ? 'PARAMETERS_INVALID'
      : null;
  };
  return {
    failure,
    send: async (attempt) => {
      const code = failure(attempt);
      if (code !== null) return refusedResult(code);
      if (
        channel === undefined ||
        attempt.email == null ||
        attempt.executionId === null ||
        attempt.locale === null
      )
        return refusedResult('DESTINATION_INVALID');
      return submissionResult(
        await channel.send({
          email: attempt.email,
          locale: attempt.locale,
          templateKey: attempt.templateKey,
          templateRevision: attempt.templateRevision,
          safeParameters: attempt.safeParameters,
          companyId: attempt.companyId,
          attemptId: attempt.id,
          executionId: attempt.executionId,
          deadline: attempt.deadline,
        }),
      );
    },
  };
}
