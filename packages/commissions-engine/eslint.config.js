import config, { COMMISSIONS_ENGINE_PATTERNS } from '@pospay/config/eslint';
import { requireArabicJsdoc } from '@pospay/config/eslint/jsdoc';

/**
 * Linted from this folder, so the shared `packages/commissions-engine/src/**` glob does not match —
 * the Arabic JSDoc block is re-scoped to `src/**` here.
 */
export default [
  ...config,
  { ...requireArabicJsdoc, files: ['src/**/*.ts'] },
  {
    // CLAUDE.architecture.md §3.1 and §7.2 rule 7 — the engine stands in for a module's domain/,
    // so it may import @pospay/domain and its own files, and nothing else (ADR-0054 §1).
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!@pospay/domain$|\\.{1,2}/).+',
              message:
                'packages/commissions-engine may import only @pospay/domain and its own files (ADR-0054 §1).',
            },
            ...COMMISSIONS_ENGINE_PATTERNS,
          ],
        },
      ],
    },
  },
];
