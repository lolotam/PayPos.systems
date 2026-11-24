import config, {
  allowCommissionsEngineBackend,
  allowDatabaseFacade,
  allowUserFacingText,
} from '@pospay/config/eslint';

export default [
  ...config,
  // ADR-0054 §1 — the API's commissions module is the one that may import the engine root.
  ...allowCommissionsEngineBackend(),
  {
    files: [
      'src/**/__tests__/whatsapp-harness.ts',
      'src/modules/notifications/http/__tests__/whatsapp-batch.spec.ts',
      'src/modules/notifications/http/__tests__/whatsapp-parser.spec.ts',
      'src/modules/notifications/http/__tests__/resend-webhook-harness.ts',
      'src/modules/notifications/http/__tests__/resend-webhook.spec.ts',
    ],
    ...allowDatabaseFacade(['createPlatformWhatsappDatabase', 'createPlatformEmailDatabase']),
    rules: {
      ...allowDatabaseFacade([
        'createPlatformWhatsappDatabase',
        'createPlatformEmailDatabase',
      ]).rules,
      'boundaries/dependencies': 'off',
    },
  },
  {
    files: ['src/main.ts'],
    ...allowDatabaseFacade(['createPlatformWhatsappDatabase', 'createPlatformEmailDatabase']),
  },
  { files: ['scripts/staging-staff-user.ts'], ...allowDatabaseFacade([], { operator: true }) },
  { files: ['src/modules/notifications/domain/whatsapp-command.ts'], ...allowUserFacingText() },
];
