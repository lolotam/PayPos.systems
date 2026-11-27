import {
  renderOperationalEmail,
  type Channel,
  type EmailRequest,
  type OnboardingEmailPayload,
} from '@pospay/notifications';
import { refusedResult, submissionResult, type Attempt } from '../domain/attempt-status.ts';
import type { ChannelPort, SendConfiguration } from '../ports/channel.port.ts';
import { isOnboardingTemplate, type OnboardingResolver } from './onboarding-envelope.ts';

export function createEmailChannelAdapter(
  channel: Channel<EmailRequest> | undefined,
  adminOrigin = 'https://app.pospay.systems',
  resolveOnboarding?: OnboardingResolver,
  verifyOnboarding?: (attempt: Attempt, payload: OnboardingEmailPayload) => Promise<boolean>,
): ChannelPort & SendConfiguration {
  // قوالب الترحيب مظروفها مشفّر: بتتفك في الذاكرة وقت الإرسال بس، وما بتتسجلش في المحاولة.
  const onboardingOf = (attempt: Parameters<SendConfiguration['failure']>[0]) =>
    isOnboardingTemplate(attempt.templateKey) ? (resolveOnboarding?.(attempt) ?? null) : null;
  const failure: SendConfiguration['failure'] = (attempt) => {
    if (channel === undefined) return 'CONFIG_INVALID';
    const isOnboarding = isOnboardingTemplate(attempt.templateKey);
    const onboarding = onboardingOf(attempt);
    if (isOnboarding && onboarding === null) return 'PARAMETERS_INVALID';
    const parameters = onboarding === null ? attempt.safeParameters : [onboarding.payload];
    return renderOperationalEmail(
      attempt.templateKey,
      attempt.templateRevision,
      attempt.locale ?? '',
      parameters,
      adminOrigin,
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
      const isOnboarding = isOnboardingTemplate(attempt.templateKey);
      const onboarding = onboardingOf(attempt);
      if (isOnboarding && onboarding === null) return refusedResult('PARAMETERS_INVALID');
      if (
        onboarding !== null &&
        verifyOnboarding !== undefined &&
        !(await verifyOnboarding(attempt, onboarding.payload))
      )
        return refusedResult('DESTINATION_INVALID');
      const result = await channel.send({
        email: onboarding?.email ?? attempt.email,
        locale: attempt.locale,
        templateKey: attempt.templateKey,
        templateRevision: attempt.templateRevision,
        safeParameters: onboarding === null ? attempt.safeParameters : [onboarding.payload],
        companyId: attempt.companyId,
        attemptId: attempt.id,
        executionId: attempt.executionId,
        deadline: attempt.deadline,
      });
      return result.kind === 'refused' ? refusedResult('CONFIG_INVALID') : submissionResult(result);
    },
  };
}
