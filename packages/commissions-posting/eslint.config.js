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
            packages: [
              '@pospay/commissions-engine',
              '@pospay/db',
              '@pospay/domain',
              '@pospay/ids',
              'drizzle-orm',
            ],
            message:
              'packages/commissions-posting may import only @pospay/commissions-engine, @pospay/db, @pospay/domain, @pospay/ids, drizzle-orm and its own files (ADR-0054 §1 addendum).',
          }),
        },
      },
    },
    rules: { 'posting/own-files-only': 'error' },
  },
  /**
   * Its domain/ is as bound as any module's (CLAUDE.architecture.md §3.1): @pospay/domain and files inside
   * domain/ only. No domain file needs the engine, so it is not named here.
   */
  {
    files: ['src/domain/**/*.ts'],
    ignores: ['src/domain/**/__tests__/**', 'src/domain/**/*.spec.ts'],
    plugins: {
      'posting-domain': {
        rules: {
          'own-files-only': ownFilesOnly({
            src: resolve(SRC, 'domain'),
            packages: ['@pospay/domain'],
            message:
              'packages/commissions-posting domain/ may import only @pospay/domain and files inside domain/ (CLAUDE.architecture.md §3.1).',
          }),
        },
      },
    },
    rules: { 'posting-domain/own-files-only': 'error' },
  },
  /**
   * The module layer rules the shared matrix applies to modules/* only (CLAUDE.architecture.md §3.1, §4.2): a use case
   * reaches its own domain/ and ports/, @pospay/domain and the engine, never persistence/, the database or the network;
   * a port is an interface and types over its own domain/, @pospay/domain, @pospay/ids and the engine's types.
   */
  {
    files: ['src/use-cases/**/*.ts'],
    ignores: ['src/use-cases/**/__tests__/**', 'src/use-cases/**/*.spec.ts'],
    plugins: {
      'posting-use-cases': {
        rules: {
          'own-files-only': ownFilesOnly({
            src: SRC,
            packages: ['@pospay/commissions-engine', '@pospay/domain'],
            folders: ['domain', 'ports', 'use-cases'],
            message:
              'packages/commissions-posting use-cases/ may import only its own domain/, ports/ and use-cases/, @pospay/domain and @pospay/commissions-engine (CLAUDE.md §4.2).',
          }),
        },
      },
    },
    rules: {
      'posting-use-cases/own-files-only': 'error',
      // Node exposes fetch as a global, so an import ban alone would miss it.
      'no-restricted-globals': [
        'error',
        {
          globals: [
            { name: 'fetch', message: 'use-cases/ reach the network only through a port.' },
          ],
          checkGlobalObject: true,
        },
      ],
    },
  },
  {
    files: ['src/ports/**/*.ts'],
    ignores: ['src/ports/**/__tests__/**', 'src/ports/**/*.spec.ts'],
    plugins: {
      'posting-ports': {
        rules: {
          'own-files-only': ownFilesOnly({
            src: SRC,
            packages: ['@pospay/commissions-engine', '@pospay/domain', '@pospay/ids'],
            folders: ['domain', 'ports'],
            message:
              'packages/commissions-posting ports/ may import only its own domain/ and ports/, @pospay/domain, @pospay/ids and @pospay/commissions-engine types (CLAUDE.architecture.md §3.1).',
          }),
        },
      },
    },
    rules: { 'posting-ports/own-files-only': 'error' },
  },
];
