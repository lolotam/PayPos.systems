import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '@pospay/config/eslint';
import { requireArabicJsdoc } from '@pospay/config/eslint/jsdoc';
import { ownFilesOnly } from '@pospay/config/eslint/own-files-only';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), 'src');

/**
 * Linted from this folder, so the shared `packages/domain/src/**` glob does not match —
 * the Arabic JSDoc block is re-scoped to `src/**` here.
 */
export default [
  ...config,
  { ...requireArabicJsdoc, files: ['src/**/*.ts'] },
  /**
   * CLAUDE.architecture.md §7.2 rule 7 — the kernel runs in the POS browser too, so it may import
   * nothing but its own files. The check resolves each specifier against the importing file rather
   * than matching its spelling: `./../../db/x.js` escapes the package, `../money.js` from a subfolder does not.
   */
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    plugins: {
      kernel: {
        rules: {
          'own-files-only': ownFilesOnly({
            src: SRC,
            packages: [],
            message:
              '@pospay/domain has zero dependencies — import only files inside packages/domain/src.',
          }),
        },
      },
    },
    rules: { 'kernel/own-files-only': 'error' },
  },
];
