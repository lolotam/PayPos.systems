import type { createTemplateRegistry } from '@pospay/notifications';
import { type Channel } from '@pospay/notifications';

import { refusedResult, submissionResult } from '../domain/attempt-status.ts';
import type { ChannelPort, SendConfiguration } from '../ports/channel.port.ts';

export function createChannelAdapter(
  channel: Channel,
  registry: ReturnType<typeof createTemplateRegistry>,
): ChannelPort & SendConfiguration {
  return {
    failure: (attempt) => {
      if (attempt.locale === null) return 'LOCALE_MISSING';
      const prepared = registry.prepare(
        attempt.templateKey,
        attempt.templateRevision,
        attempt.locale,
        attempt.safeParameters,
      );
      return !prepared.valid || prepared.name !== attempt.providerTemplateName
        ? prepared.valid
          ? 'CONFIG_INVALID'
          : prepared.code
        : null;
    },
    send: async (attempt) => {
      if (attempt.locale === null || attempt.phone === null)
        return refusedResult('DESTINATION_INVALID');
      const prepared = registry.prepare(
        attempt.templateKey,
        attempt.templateRevision,
        attempt.locale,
        attempt.safeParameters,
      );
      if (!prepared.valid || prepared.name !== attempt.providerTemplateName)
        return refusedResult('CONFIG_INVALID');
      const result = await channel.send({
        phone: attempt.phone,
        locale: attempt.locale,
        deadline: attempt.deadline,
        providerTemplateName: prepared.name,
        components: prepared.components,
      });
      if (result.kind === 'refused') return refusedResult('CONFIG_INVALID');
      return submissionResult(result);
    },
  };
}
