import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config, { allowCommissionsEnginePackage } from '@pospay/config/eslint';
import { ownFilesOnly } from '@pospay/config/eslint/own-files-only';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), 'src');

/**
 * ADR-0054 §1 addendum (PP-226) — the correction step may import the engine's root entry from its use-cases/,
 * ports/ and persistence/, exactly as the commissions modules do, and imports nothing outside the packages
 * named here. The Arabic JSDoc gate of CLAUDE.md §3.1 covers its domain/ and ports/ through the shared config.
 */
export default [
  ...config,
  ...allowCommissionsEnginePackage(),
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/**/*.spec.ts'],
    plugins: {
      posting: {
        rules: {
          'own-files-only': ownFilesOnly({
            src: SRC,
            packages: ['@pospay/commissions-engine', '@pospay/db', '@pospay/domain', 'drizzle-orm'],
            message:
              'packages/commissions-posting may import only @pospay/commissions-engine, @pospay/db, @pospay/domain, drizzle-orm and its own files (ADR-0054 §1 addendum).',
          }),
        },
      },
    },
    rules: { 'posting/own-files-only': 'error' },
  },
];
