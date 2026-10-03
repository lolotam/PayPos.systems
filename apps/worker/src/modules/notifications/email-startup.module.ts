import { readEmailConfiguration } from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import { closeOptional, optionalWithin } from '../../shared/optional-capability.ts';
import { createEmailModule, type EmailModuleOptions } from './email.module.ts';

type EmailModule = ReturnType<typeof createEmailModule>;
type StartupOptions = Pick<EmailModuleOptions, 'production' | 'clock' | 'ids'> & {
  readonly env: NodeJS.ProcessEnv;
  readonly logger: Logger;
};

export async function startEmailCapability(
  options: StartupOptions,
  initialize: () => Promise<EmailModule> = async () =>
    createEmailModule({ ...options, configuration: readEmailConfiguration(options.env) }),
) {
  const fallback = createEmailModule(options);
  let current = fallback;
  let closed = false;
  let state: 'DISABLED' | 'UNAVAILABLE' = 'DISABLED';
  try {
    // الإعداد البريدي مستقل: لا يدخل readiness الأساسي ولا يفتح الإرسال قبل feedback.
    current = await optionalWithin(initialize);
  } catch {
    state = 'UNAVAILABLE';
    await closeOptional([
      async () => {
        current = fallback;
      },
    ]);
  }
  options.logger.info(
    {
      capability: {
        channel: 'email',
        enabled: false,
        reason: fallback.capability.reason,
        name: 'EMAIL',
        state,
      },
    },
    'email disabled',
  );
  const stop = () => {
    closed = true;
    current = fallback;
  };
  return {
    module: {
      capability: fallback.capability,
      adapter: fallback.adapter,
      matches: (...args: Parameters<EmailModule['matches']>) => !closed && current.matches(...args),
      authorize: async (...args: Parameters<EmailModule['authorize']>) => {
        if (closed) throw new Error('EMAIL_CAPABILITY_CLOSED');
        await current.authorize(...args);
      },
    },
    stop,
    close: async () => {
      stop();
    },
  };
}
