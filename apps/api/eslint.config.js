import config, { allowDatabaseFacade, allowUserFacingText } from '@pospay/config/eslint';

export default [
  ...config,
  {
    files: [
      'src/**/__tests__/whatsapp-harness.ts',
      'src/modules/notifications/http/__tests__/whatsapp-batch.spec.ts',
      'src/modules/notifications/http/__tests__/whatsapp-parser.spec.ts',
    ],
    ...allowDatabaseFacade('createPlatformWhatsappDatabase'),
    rules: {
      ...allowDatabaseFacade('createPlatformWhatsappDatabase').rules,
      'boundaries/dependencies': 'off',
    },
  },
  { files: ['src/main.ts'], ...allowDatabaseFacade('createPlatformWhatsappDatabase') },
  { files: ['src/modules/notifications/domain/whatsapp-command.ts'], ...allowUserFacingText() },
];
