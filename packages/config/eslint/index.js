import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { boundariesConfig } from './boundaries.js';
import { CREDENTIAL_PATHS, CREDENTIAL_PATTERNS, CREDENTIAL_SYNTAX } from './credentials.js';
import { jsdocConfig } from './jsdoc.js';

const sizeLimitExcludes = [
  'packages/db/schema/**',
  '**/migrations/**',
  '**/generated/**',
  '**/fixtures/**',
];

// ADR-0003 §3: two restricted database facades, each wired by exactly one owner. Everyone else is refused;
// the owner re-enables its own facade with `allowDatabaseFacade` in its eslint.config.js.
const FACADES = {
  createAuthDatabase: 'the pospay_auth facade belongs to packages/auth (ADR-0003 §2.1).',
  createOutboxDispatcherDatabase:
    'the pospay_dispatcher facade belongs to apps/worker (ADR-0003 §3).',
};
const facadeRule = (allowed, credentials = false) => [
  'error',
  {
    paths: [
      ...Object.entries(FACADES)
        .filter(([name]) => name !== allowed)
        .map(([name, message]) => ({ name: '@pospay/db', importNames: [name], message })),
      ...(credentials ? [] : CREDENTIAL_PATHS),
    ],
    patterns: credentials ? [] : CREDENTIAL_PATTERNS,
  },
];

/**
 * The override a facade's owner adds: every other facade stays refused.
 *
 * @param {keyof typeof FACADES} allowed the facade this package owns
 * @param {{ credentials?: boolean }} [options] credentials: true only for packages/auth, the one owner of hashing
 * @returns {import('eslint').Linter.Config} the override
 */
export const allowDatabaseFacade = (allowed, options = {}) => ({
  rules: { 'no-restricted-imports': facadeRule(allowed, options.credentials === true) },
});

/** Shared flat config. Every app and package re-exports this from its own eslint.config.js. */
export const config = tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/.turbo/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // CLAUDE.md §3.1 — the three banned debt markers fail the build (the softer marker only warns, via lint:docs).
      'no-warning-comments': ['error', { terms: ['fixme', 'hack', 'xxx'], location: 'anywhere' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': facadeRule(null),
      '@typescript-eslint/consistent-type-imports': 'error',
      // NestJS modules are empty classes that exist to carry @Module(); undecorated ones stay banned.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      // CLAUDE.md §8 — a log message is a constant event name; data goes in fields, where the sanitiser
      // (@pospay/observability) can redact it. The logger also withholds messages that look like data.
      'no-restricted-syntax': [
        'error',
        ...CREDENTIAL_SYNTAX,
        {
          selector:
            'CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] > TemplateLiteral[expressions.length>0]',
          message: 'Log messages are constant event names — put dynamic values in the log object.',
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] > BinaryExpression[operator='+']",
          message: 'Log messages are constant event names — put dynamic values in the log object.',
        },
      ],
    },
  },
  {
    // CLAUDE.md §3 — file and function size.
    files: ['**/*.ts', '**/*.tsx'],
    ignores: sizeLimitExcludes,
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  ...boundariesConfig,
  ...jsdocConfig,
  prettier,
);

export default config;
