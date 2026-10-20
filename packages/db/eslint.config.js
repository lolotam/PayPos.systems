import config, { allowUserFacingText } from '@pospay/config/eslint';

export default [
  ...config,
  // Reference rows carry their own bilingual name columns (name_ar, CLAUDE.md §5) — that is data, not interface text.
  { files: ['src/seed.ts'], ...allowUserFacingText() },
  // CLAUDE.md §3 excludes the schema from max-lines; the shared pattern is repo-root relative and never matches when lint runs here.
  { files: ['schema/**'], rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' } },
];
