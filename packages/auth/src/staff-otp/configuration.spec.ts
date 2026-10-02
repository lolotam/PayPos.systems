import { describe, expect, it } from 'vitest';
import { readStaffOtpConfiguration } from './configuration.ts';

const components = JSON.stringify([
  { type: 'body' },
  { type: 'button', sub_type: 'url', index: '0' },
]);
const valid: NodeJS.ProcessEnv = {
  STAFF_OTP_ENABLED: 'true',
  NOTIFICATIONS_MODE: 'live',
  WHATSAPP_STOP_SUBSCRIPTION_CONFIRMED: 'true',
  STAFF_OTP_TEMPLATES_APPROVED: 'true',
  WHATSAPP_GRAPH_API_VERSION: 'v23.0',
  AUTH_DATABASE_URL: 'synthetic',
  REDIS_URL: 'synthetic',
  WHATSAPP_APP_SECRET: 'synthetic',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'synthetic',
  WHATSAPP_WABA_ID: 'synthetic',
  WHATSAPP_PHONE_NUMBER_ID: 'synthetic',
  PLATFORM_NOTIFICATIONS_DATABASE_URL: 'synthetic',
  NOTIFICATION_PHONE_HASH_KEY: 'synthetic'.repeat(8),
  NOTIFICATION_PHONE_HASH_KEY_ID: 'synthetic-h',
  NOTIFICATION_MESSAGE_ID_HASH_KEY: 'synthetic'.repeat(8),
  WHATSAPP_ACCESS_TOKEN: 'synthetic',
  STAFF_OTP_POS_ORIGIN: 'https://pos.synthetic.invalid',
  AUTH_TRUSTED_ORIGINS: 'https://pos.synthetic.invalid',
  STAFF_OTP_TEMPLATE_AR: 'synthetic_ar',
  STAFF_OTP_TEMPLATE_EN: 'synthetic_en',
  STAFF_OTP_COMPONENTS_AR: components,
  STAFF_OTP_COMPONENTS_EN: components,
  STAFF_OTP_DERIVATION_KEY_ID: 'synthetic-d',
  STAFF_OTP_VERIFICATION_KEY_ID: 'synthetic-v',
  STAFF_OTP_DERIVATION_KEY: Buffer.alloc(32, 17).toString('base64'),
  STAFF_OTP_VERIFICATION_KEY: Buffer.alloc(32, 29).toString('base64'),
};

describe('OTP capability is independent of ordinary production readiness', () => {
  it.each([undefined, '', 'false'])('is disabled by default even in production (%s)', (enabled) => {
    expect(
      readStaffOtpConfiguration({ NODE_ENV: 'production', STAFF_OTP_ENABLED: enabled }, 'api')
        .state,
    ).toBe('DISABLED');
  });
  it('closes only the capability for incomplete or malformed activation', () => {
    for (const name of Object.keys(valid)) {
      if (name === 'WHATSAPP_ACCESS_TOKEN') continue;
      expect(readStaffOtpConfiguration({ ...valid, [name]: '' }, 'worker').state).not.toBe('READY');
    }
    expect(readStaffOtpConfiguration({ STAFF_OTP_ENABLED: 'true' }, 'worker').state).toBe(
      'UNAVAILABLE',
    );
    expect(readStaffOtpConfiguration({ ...valid, NOTIFICATIONS_MODE: 'fake' }, 'api').state).toBe(
      'UNAVAILABLE',
    );
  });
  it('requires no sending credential at the API and agrees with the worker', () => {
    const api = readStaffOtpConfiguration({ ...valid, WHATSAPP_ACCESS_TOKEN: '' }, 'api');
    const worker = readStaffOtpConfiguration(valid, 'worker');
    expect(api.state).toBe('READY');
    expect(worker.state).toBe('READY');
    if (api.state === 'READY' && worker.state === 'READY')
      expect(api.fingerprint).toBe(worker.fingerprint);
    expect(readStaffOtpConfiguration({ ...valid, WHATSAPP_ACCESS_TOKEN: '' }, 'worker').state).toBe(
      'UNAVAILABLE',
    );
  });
  it('refuses retiring-key metadata that overwrites the active key id', () => {
    const env = {
      ...valid,
      STAFF_OTP_DERIVATION_RETIRED_KEYS: JSON.stringify({
        'synthetic-d': Buffer.alloc(32, 37).toString('base64'),
      }),
    };
    expect(readStaffOtpConfiguration(env, 'api').state).toBe('UNAVAILABLE');
    expect(readStaffOtpConfiguration(env, 'worker').state).toBe('UNAVAILABLE');
  });
});
