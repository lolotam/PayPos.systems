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
    // #1000, #1334 — the commissions jobs reach the database through persistence/ only: every runtime
    // form of @pospay/db is refused here, and the types stay.
    files: ['src/modules/commissions/jobs/**/*.ts'],
    ...banRuntimeDatabaseImport(),
  },
  {
    // #1334 — a commissions job test keeps the Arabic-text exemption; the runtime database ban stays.
    files: [
      'src/modules/commissions/jobs/**/__tests__/**/*.ts',
      'src/modules/commissions/jobs/**/*.spec.ts',
    ],
    ...banRuntimeDatabaseImport({ userText: true }),
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
