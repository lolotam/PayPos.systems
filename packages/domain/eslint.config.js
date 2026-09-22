import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '@pospay/config/eslint';
import { requireArabicJsdoc } from '@pospay/config/eslint/jsdoc';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), 'src');

/**
 * CLAUDE.architecture.md §7.2 rule 7 — the kernel runs in the POS browser too, so it may import
 * nothing but its own files. The check resolves each specifier against the importing file rather
 * than matching its spelling: `./../../db/x.js` escapes the package, `../money.js` from a subfolder does not.
 */
const ownFilesOnly = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      outside:
        '@pospay/domain has zero dependencies — import only files inside packages/domain/src.',
    },
  },
  create(context) {
    const check = (source) => {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') {
        if (source) context.report({ node: source, messageId: 'outside' });
        return;
      }
      const target = source.value.startsWith('.')
        ? relative(SRC, resolve(dirname(context.filename), source.value))
        : null;
      if (target === null || target.startsWith('..') || isAbsolute(target)) {
        context.report({ node: source, messageId: 'outside' });
      }
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

/**
 * Linted from this folder, so the shared `packages/domain/src/**` glob does not match —
 * the Arabic JSDoc block is re-scoped to `src/**` here.
 */
export default [
  ...config,
  { ...requireArabicJsdoc, files: ['src/**/*.ts'] },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    plugins: { kernel: { rules: { 'own-files-only': ownFilesOnly } } },
    rules: { 'kernel/own-files-only': 'error' },
  },
];
