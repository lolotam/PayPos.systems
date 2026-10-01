import { WHATSAPP_PROVIDER_ID } from './identifier-patterns.ts';
import type { SafeParameter, TemplateDefinition } from './templates/definition.ts';
import { templateComponents, validateParameters } from './templates/definition.ts';
import { staffOtp } from './templates/staff-otp.ts';

export const GRAPH_API_VERSION = 'v23.0';
export interface NotificationConfiguration {
  readonly mode: 'fake' | 'live';
  readonly hashKey: string;
  readonly hashKeyId: string;
  readonly accessToken?: string;
  readonly phoneNumberId?: string;
}

export function readNotificationConfiguration(env: NodeJS.ProcessEnv): NotificationConfiguration {
  const mode = env['NOTIFICATIONS_MODE'] ?? 'fake';
  if (mode !== 'fake' && mode !== 'live') throw new Error('NOTIFICATIONS_MODE_INVALID');
  if (mode === 'fake' && env['NODE_ENV'] === 'production')
    throw new Error('NOTIFICATIONS_FAKE_IN_PRODUCTION');
  const hashKey = env['NOTIFICATION_PHONE_HASH_KEY'];
  const hashKeyId = env['NOTIFICATION_PHONE_HASH_KEY_ID'];
  if (hashKey === undefined || hashKey.length < 32 || hashKeyId === undefined) {
    throw new Error('NOTIFICATION_HASH_CONFIG_INVALID');
  }
  if ((env['WHATSAPP_GRAPH_API_VERSION'] ?? GRAPH_API_VERSION) !== GRAPH_API_VERSION) {
    throw new Error('NOTIFICATION_GRAPH_VERSION_INVALID');
  }
  if (mode === 'live') {
    const accessToken = env['WHATSAPP_ACCESS_TOKEN'];
    const phoneNumberId = env['WHATSAPP_PHONE_NUMBER_ID'];
    if (!accessToken || !phoneNumberId || !WHATSAPP_PROVIDER_ID.test(phoneNumberId))
      throw new Error('NOTIFICATION_PROVIDER_CONFIG_INVALID');
    return { mode, hashKey, hashKeyId, accessToken, phoneNumberId };
  }
  return { mode, hashKey, hashKeyId };
}

export type TemplatePreparation =
  | { readonly valid: false; readonly code: 'CONFIG_INVALID' | 'PARAMETERS_INVALID' }
  | {
      readonly valid: true;
      readonly name: string;
      readonly components: ReturnType<typeof templateComponents>;
    };

export function createTemplateRegistry(
  definitions: readonly TemplateDefinition[] = [staffOtp],
  approvedNames: Readonly<Record<string, Readonly<Partial<Record<'ar' | 'en', string>>>>> = {},
) {
  return {
    prepare(
      key: string,
      revision: number,
      locale: 'ar' | 'en',
      parameters: readonly SafeParameter[],
    ): TemplatePreparation {
      const definition = definitions.find((d) => d.key === key && d.revision === revision);
      if (definition === undefined) return { valid: false, code: 'CONFIG_INVALID' };
      if (!validateParameters(definition, locale, parameters))
        return { valid: false, code: 'PARAMETERS_INVALID' };
      const name = approvedNames[key]?.[locale];
      // TODO(spec): every real approved template name must be supplied after owner/Meta approval.
      if (name === undefined || !/^[a-z][a-z0-9_]{0,511}$/.test(name))
        return { valid: false, code: 'CONFIG_INVALID' };
      return { valid: true, name, components: templateComponents(definition, parameters) };
    },
  };
}
