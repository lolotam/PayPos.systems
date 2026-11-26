import config, { allowCommissionsEngineBackend, allowDatabaseFacade } from '@pospay/config/eslint';

export default [
  ...config,
  allowDatabaseFacade('createOutboxDispatcherDatabase'),
  ...allowCommissionsEngineBackend({ facades: 'createOutboxDispatcherDatabase' }),
  {
    files: ['src/**/__tests__/platform-harness.ts'],
    ...allowDatabaseFacade(['createOutboxDispatcherDatabase', 'createPlatformWhatsappDatabase']),
  },
  {
    files: ['src/**/__tests__/email-feedback-harness.ts'],
    ...allowDatabaseFacade(['createOutboxDispatcherDatabase', 'createPlatformEmailDatabase']),
  },
  {
    files: ['src/modules/notifications/email-startup.module.ts'],
    ...allowDatabaseFacade(['createOutboxDispatcherDatabase', 'createPlatformEmailDatabase']),
  },
  {
    files: ['src/start-optional-capabilities.ts'],
    ...allowDatabaseFacade([
      'createOutboxDispatcherDatabase',
      'createPlatformWhatsappDatabase',
      'createPlatformEmailDatabase',
    ]),
  },
];
