import config, { allowUserFacingText } from '@pospay/config/eslint';

export default [
  ...config,
  // Reference rows carry their own bilingual name columns (name_ar, CLAUDE.md §5) — that is data, not interface text.
  { files: ['src/seed.ts'], ...allowUserFacingText() },
];
