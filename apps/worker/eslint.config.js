import config, {
  allowCommissionsEngineBackend,
  allowDatabaseFacade,
} from '@pospay/config/eslint';

export default [
  ...config,
  ...allowCommissionsEngineBackend(),
  allowDatabaseFacade('createOutboxDispatcherDatabase'),
  {
    files: ['src/**/__tests__/platform-harness.ts'],
    ...allowDatabaseFacade(['createOutboxDispatcherDatabase', 'createPlatformWhatsappDatabase']),
  },
  {
    files: ['src/start-optional-capabilities.ts'],
    ...allowDatabaseFacade(['createOutboxDispatcherDatabase', 'createPlatformWhatsappDatabase']),
  },
];
