import config, { allowDatabaseFacade } from '@pospay/config/eslint';

export default [
  ...config,
  allowDatabaseFacade('createOutboxDispatcherDatabase'),
  {
    files: ['src/**/__tests__/platform-harness.ts'],
    ...allowDatabaseFacade(['createOutboxDispatcherDatabase', 'createPlatformWhatsappDatabase']),
  },
  {
    files: ['src/main.ts'],
    ...allowDatabaseFacade(['createOutboxDispatcherDatabase', 'createPlatformWhatsappDatabase']),
  },
];
