import config from '@pospay/config/eslint';
import { requireArabicJsdoc } from '@pospay/config/eslint/jsdoc';

/**
 * Linted from this folder, so the shared `packages/domain/src/**` glob does not match —
 * the Arabic JSDoc block is re-scoped to `src/**` here.
 */
export default [
  ...config,
  { ...requireArabicJsdoc, files: ['src/**/*.ts'] },
  {
    // CLAUDE.architecture.md §7.2 rule 7 — the kernel runs in the POS browser too,
    // so it may import nothing but its own files: no packages, no `node:` built-ins.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\./).+',
              message: '@pospay/domain has zero dependencies — import only its own files.',
            },
          ],
        },
      ],
    },
  },
];
