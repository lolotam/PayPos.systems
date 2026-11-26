import config, {
  allowCommissionsEngineBackend,
  allowDatabaseFacade,
  banRuntimeDatabaseImport,
} from '@pospay/config/eslint';

export default [
  ...config,
  allowDatabaseFacade('createOutboxDispatcherDatabase'),
  ...allowCommissionsEngineBackend({ facades: 'createOutboxDispatcherDatabase' }),
  {
    // #1000 — the commissions jobs reach the database through persistence/ only: the runtime import
    // of @pospay/db is refused here, and the types stay.
    files: ['src/modules/commissions/jobs/**/*.ts'],
    ...banRuntimeDatabaseImport(),
  },
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
