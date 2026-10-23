import config, { allowUserFacingText } from '@pospay/config/eslint';

export default [
  ...config,
  { files: ['src/templates/**', 'src/push/templates.ts'], ...allowUserFacingText() },
];
