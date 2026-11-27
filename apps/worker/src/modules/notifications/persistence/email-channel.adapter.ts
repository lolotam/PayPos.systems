import {
  renderOperationalEmail,
  type Channel,
  type EmailRequest,
  type OnboardingEmailPayload,
} from '@pospay/notifications';
import { refusedResult, submissionResult, type Attempt } from '../domain/attempt-status.ts';
import type { ChannelPort, SendConfiguration } from '../ports/channel.port.ts';
import { isOnboardingTemplate, type OnboardingResolver } from './onboarding-envelope.ts';

/** يفحص إعداد القالب والمعاملات المظروفية للمحاولة ويرجع رمز الفشل أو null. */
function configurationFailure(
  channel: Channel<EmailRequest> | undefined,
  attempt: Attempt,
  onboarding: ReturnType<OnboardingResolver> | null,
  adminOrigin: string,
) {
  if (channel === undefined) return 'CONFIG_INVALID' as const;
  if (isOnboardingTemplate(attempt.templateKey) && onboarding === null)
    return 'PARAMETERS_INVALID' as const;
  const parameters = onboarding === null ? attempt.safeParameters : [onboarding.payload];
  return renderOperationalEmail(
    attempt.templateKey,
    attempt.templateRevision,
    attempt.locale ?? '',
    parameters,
    adminOrigin,
  ) === null
    ? ('PARAMETERS_INVALID' as const)
    : null;
}

/** يرسل المحاولة المقفولة عبر قناة البريد بعد فك مظروفها في الذاكرة وقت التنفيذ. */
async function dispatchEmail(
  channel: Channel<EmailRequest> | undefined,
  attempt: Attempt,
  resolve: (attempt: Attempt) => ReturnType<OnboardingResolver> | null,
  adminOrigin: string,
) {
  const onboarding = resolve(attempt);
  const code = configurationFailure(channel, attempt, onboarding, adminOrigin);
  if (code !== null) return refusedResult(code);
  if (
    channel === undefined ||
    attempt.email == null ||
    attempt.executionId === null ||
    attempt.locale === null
  )
    return refusedResult('DESTINATION_INVALID');
  if (isOnboardingTemplate(attempt.templateKey) && onboarding === null)
    return refusedResult('PARAMETERS_INVALID');
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
}

export function createEmailChannelAdapter(
  channel: Channel<EmailRequest> | undefined,
  adminOrigin = 'https://app.pospay.systems',
  resolveOnboarding?: OnboardingResolver,
  verifyOnboarding?: (
    attempt: Attempt,
    payload: OnboardingEmailPayload,
    scope?: unknown,
  ) => Promise<boolean>,
): ChannelPort & SendConfiguration {
  // قوالب الترحيب مظروفها مشفّر: بتتفك في الذاكرة وقت الإرسال بس، وما بتتسجلش في المحاولة.
  const onboardingOf = (attempt: Parameters<SendConfiguration['failure']>[0]) =>
    isOnboardingTemplate(attempt.templateKey) ? (resolveOnboarding?.(attempt) ?? null) : null;
  return {
    failure: (attempt) =>
      configurationFailure(channel, attempt, onboardingOf(attempt), adminOrigin),
    verify: async (attempt, scope) => {
      const onboarding = onboardingOf(attempt);
      if (onboarding === null || verifyOnboarding === undefined) return true;
      return verifyOnboarding(attempt, onboarding.payload, scope);
    },
    send: (attempt) => dispatchEmail(channel, attempt, onboardingOf, adminOrigin),
  };
}
