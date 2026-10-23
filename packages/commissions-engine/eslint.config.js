import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '@pospay/config/eslint';
import { requireArabicJsdoc } from '@pospay/config/eslint/jsdoc';
import { ownFilesOnly } from '@pospay/config/eslint/own-files-only';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), 'src');

/**
 * Linted from this folder, so the shared `packages/commissions-engine/src/**` glob does not match —
 * the Arabic JSDoc block is re-scoped to `src/**` here.
 */
export default [
  ...config,
  { ...requireArabicJsdoc, files: ['src/**/*.ts'] },
  /**
   * CLAUDE.architecture.md §3.1 and §7.2 rule 7 — the engine stands in for a module's domain/, so it
   * may import @pospay/domain and its own files, and nothing else (ADR-0054 §1).
   */
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/**/*.spec.ts'],
    plugins: {
      engine: {
        rules: {
          'own-files-only': ownFilesOnly({
            src: SRC,
            packages: ['@pospay/domain'],
            message:
              'packages/commissions-engine may import only @pospay/domain and its own files (ADR-0054 §1).',
          }),
        },
      },
    },
    rules: { 'engine/own-files-only': 'error' },
  },
];
