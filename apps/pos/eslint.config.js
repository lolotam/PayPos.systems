import config, { allowUserFacingText } from '@pospay/config/eslint';

export default [
  { ignores: ['src/shared/api/schema.d.ts'] },
  ...config,
  {
    // CI-only navigation component fixture: its caller-supplied Arabic labels are test data, not product copy.
    files: [
      'e2e/navigation-components.pw.ts',
      'e2e/navigation-helpers.ts',
      'e2e/navigation-fixture/main.tsx',
    ],
    ...allowUserFacingText(),
  },
];
