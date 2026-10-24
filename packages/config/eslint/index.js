import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import {
  boundariesConfig,
  COMMISSIONS_ENGINE_PATH_BAN,
  COMMISSIONS_ENGINE_PATH_SYNTAX,
  COMMISSIONS_ENGINE_PATTERNS,
  COMMISSIONS_ENGINE_ROOT_BAN,
  COMMISSIONS_ENGINE_ROOT_SYNTAX,
  COMMISSIONS_ENGINE_SUBPATH_BAN,
  COMMISSIONS_ENGINE_SUBPATH_SYNTAX,
  COMMISSIONS_ENGINE_SYNTAX,
  COMMISSIONS_ENGINE_VALIDATION_ONLY_BAN,
  COMMISSIONS_ENGINE_VALIDATION_ONLY_SYNTAX,
  USE_CASES_INFRASTRUCTURE_PATTERN,
} from './boundaries.js';
import { CREDENTIAL_PATHS, CREDENTIAL_PATTERNS, CREDENTIAL_SYNTAX } from './credentials.js';
import { jsdocConfig } from './jsdoc.js';
import { frontendConfig } from './frontend.js';

const sizeLimitExcludes = [
  'packages/db/schema/**',
  '**/migrations/**',
  '**/generated/**',
  '**/fixtures/**',
];

// ADR-0003 §3: restricted database facades, each wired by exactly one owner. Everyone else is refused;
// the owner re-enables its own facade with `allowDatabaseFacade` in its eslint.config.js.
const FACADES = {
  createAuthDatabase: 'the pospay_auth facade belongs to packages/auth (ADR-0003 §2.1).',
  createStaffOtpDatabase: 'staff OTP global identity belongs to packages/auth (ADR-0019).',
  createOutboxDispatcherDatabase:
    'the pospay_dispatcher facade belongs to apps/worker (ADR-0003 §3).',
  createPlatformWhatsappDatabase:
    'the global messaging facade is wired only by API/worker roots (ADR-0013).',
};
const OPERATOR_MESSAGE =
  'operator helpers are for apps/api/scripts only (PP-58.3, ADR-0003 addendum)';
const OPERATOR_PATTERNS = ['db', 'auth'].map((name) => ({
  regex: `^@pospay/${name}/operator/.*$`,
  message: OPERATOR_MESSAGE,
}));
const OPERATOR_IMPORT = '/^@pospay\\/(db|auth)\\/operator\\/.+$/';
const OPERATOR_SYNTAX = [
  { selector: `ImportExpression[source.value=${OPERATOR_IMPORT}]`, message: OPERATOR_MESSAGE },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=${OPERATOR_IMPORT}]`,
    message: OPERATOR_MESSAGE,
  },
  {
    selector: `TSImportType[argument.literal.value=${OPERATOR_IMPORT}]`,
    message: OPERATOR_MESSAGE,
  },
];
const facadeRule = (
  allowed,
  credentials = false,
  engine = COMMISSIONS_ENGINE_PATTERNS,
  operator = false,
) => [
  'error',
  {
    paths: [
      ...Object.entries(FACADES)
        .filter(([name]) => !(Array.isArray(allowed) ? allowed : [allowed]).includes(name))
        .map(([name, message]) => ({ name: '@pospay/db', importNames: [name], message })),
      ...(credentials ? [] : CREDENTIAL_PATHS),
    ],
    patterns: [
      ...(credentials ? [] : CREDENTIAL_PATTERNS),
      ...(operator ? [] : OPERATOR_PATTERNS),
      ...engine,
    ],
  },
];

/**
 * The override a facade's owner adds: every other facade stays refused.
 *
 * @param {keyof typeof FACADES | (keyof typeof FACADES)[]} allowed the facade this package owns
 * @param {{ credentials?: boolean, operator?: boolean }} [options] credentials is only for packages/auth;
 *   operator lifts only the two PP-58.3 subpath bans for the staging CLI
 * @returns {import('eslint').Linter.Config} the override
 */
export const allowDatabaseFacade = (allowed, options = {}) => ({
  rules: {
    'no-restricted-imports': facadeRule(
      allowed,
      options.credentials === true,
      COMMISSIONS_ENGINE_PATTERNS,
      options.operator === true,
    ),
    ...(options.operator === true
      ? { 'no-restricted-syntax': restrictedSyntax({ userText: false, operator: false }) }
      : {}),
  },
});

// CLAUDE.md §8 — a log message is a constant event name; data goes in fields, where the sanitiser
// (@pospay/observability) can redact it. The logger also withholds messages that look like data.
const LOG_SYNTAX = [
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
];

// CLAUDE.md §7 — text a user reads lives in packages/i18n. Arabic in a string is always such text, so it is refused
// anywhere else; comments are not strings and stay Arabic (§3.1).
const USER_TEXT =
  'Arabic text belongs in packages/i18n (CLAUDE.md §7) — add a catalog key and use t().';
// Built from code points so this file holds no Arabic itself: the Arabic blocks, the supplement, extended-A and both
// presentation-form blocks (ligatures like lam-alef live there).
const ARABIC_BLOCKS = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];
const ARABIC = `/[${ARABIC_BLOCKS.map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join('')}]/`;
// value is the decoded string, so an escaped letter is caught too; JSXText is the text between tags.
const USER_TEXT_SYNTAX = [
  { selector: `Literal[value=${ARABIC}]`, message: USER_TEXT },
  { selector: `TemplateElement[value.cooked=${ARABIC}]`, message: USER_TEXT },
  { selector: `JSXText[value=${ARABIC}]`, message: USER_TEXT },
];

const restrictedSyntax = ({ userText, engine = COMMISSIONS_ENGINE_SYNTAX, operator = true }) => [
  'error',
  ...CREDENTIAL_SYNTAX,
  ...engine,
  ...LOG_SYNTAX,
  ...(operator ? OPERATOR_SYNTAX : []),
  ...(userText ? [] : USER_TEXT_SYNTAX),
];

/**
 * The override for code that may hold user-facing text: packages/i18n, and tests that assert it.
 *
 * @returns {import('eslint').Linter.Config} the override
 */
export const allowUserFacingText = () => ({
  rules: { 'no-restricted-syntax': restrictedSyntax({ userText: true }) },
});

// ADR-0054 §1 — the backend exceptions lift the engine's root entry only: a subpath and a relative
// path stay refused everywhere, and a test file keeps the Arabic-text exemption.
const BACKEND_ENGINE_SYNTAX = [
  ...COMMISSIONS_ENGINE_SUBPATH_SYNTAX,
  ...COMMISSIONS_ENGINE_PATH_SYNTAX,
];

// ADR-0054 §1 — the admin area allows the browser-safe /validation entry point and nothing else.
const ADMIN_ENGINE_SYNTAX = [
  ...COMMISSIONS_ENGINE_ROOT_SYNTAX,
  ...COMMISSIONS_ENGINE_VALIDATION_ONLY_SYNTAX,
  ...COMMISSIONS_ENGINE_PATH_SYNTAX,
];

/**
 * The override for the backend apps whose commissions module may import the engine root: only those
 * apps append it — today apps/api; apps/worker appends it with 50-1, when its commissions module
 * arrives. The blocks lift the root entry of the commissions use-cases/, ports/ and persistence/
 * — the layers CLAUDE.architecture.md §3.1 lets import a module's own domain/ — and nothing else.
 *
 * @returns {import('eslint').Linter.Config[]} the four blocks of the commissions layers
 */
export const allowCommissionsEngineBackend = () => [
  {
    // ADR-0054 §1 — the commissions use-cases/ lift the engine's root entry and nothing else.
    files: ['**/modules/commissions/use-cases/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: CREDENTIAL_PATHS,
          patterns: [
            ...CREDENTIAL_PATTERNS,
            USE_CASES_INFRASTRUCTURE_PATTERN,
            COMMISSIONS_ENGINE_SUBPATH_BAN,
            COMMISSIONS_ENGINE_PATH_BAN,
          ],
        },
      ],
      'no-restricted-syntax': restrictedSyntax({
        userText: false,
        engine: BACKEND_ENGINE_SYNTAX,
      }),
    },
  },
  {
    // ADR-0054 §1 — a commissions use-case test keeps the Arabic-text exemption.
    files: [
      '**/modules/commissions/use-cases/**/__tests__/**',
      '**/modules/commissions/use-cases/__tests__/**',
      '**/modules/commissions/use-cases/**/*.spec.ts',
      '**/modules/commissions/use-cases/**/test/**',
      '**/modules/commissions/use-cases/test/**',
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        userText: true,
        engine: BACKEND_ENGINE_SYNTAX,
      }),
    },
  },
  {
    // ADR-0054 §1 — the commissions ports/ and persistence/ lift the engine's root entry only.
    files: ['**/modules/commissions/ports/**/*.ts', '**/modules/commissions/persistence/**/*.ts'],
    rules: {
      'no-restricted-imports': facadeRule(null, false, [
        COMMISSIONS_ENGINE_SUBPATH_BAN,
        COMMISSIONS_ENGINE_PATH_BAN,
      ]),
      'no-restricted-syntax': restrictedSyntax({
        userText: false,
        engine: BACKEND_ENGINE_SYNTAX,
      }),
    },
  },
  {
    // ADR-0054 §1 — a commissions port or persistence test keeps the Arabic-text exemption.
    files: [
      '**/modules/commissions/ports/**/__tests__/**',
      '**/modules/commissions/ports/__tests__/**',
      '**/modules/commissions/ports/**/*.spec.ts',
      '**/modules/commissions/ports/**/test/**',
      '**/modules/commissions/ports/test/**',
      '**/modules/commissions/persistence/**/__tests__/**',
      '**/modules/commissions/persistence/__tests__/**',
      '**/modules/commissions/persistence/**/*.spec.ts',
      '**/modules/commissions/persistence/**/test/**',
      '**/modules/commissions/persistence/test/**',
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        userText: true,
        engine: BACKEND_ENGINE_SYNTAX,
      }),
    },
  },
];

/**
 * The override for apps/admin's commissions area: it may import the engine's browser-safe
 * /validation entry point and nothing else of the package (ADR-0054 §1, spec 059 D-17).
 *
 * @returns {import('eslint').Linter.Config[]} the two blocks for apps/admin
 */
export const allowCommissionsEngineValidation = () => [
  {
    files: ['src/commissions/**/*.ts', 'src/commissions/**/*.tsx'],
    rules: {
      'no-restricted-imports': facadeRule(null, false, [
        COMMISSIONS_ENGINE_ROOT_BAN,
        COMMISSIONS_ENGINE_VALIDATION_ONLY_BAN,
        COMMISSIONS_ENGINE_PATH_BAN,
      ]),
      'no-restricted-syntax': restrictedSyntax({
        userText: false,
        engine: ADMIN_ENGINE_SYNTAX,
      }),
    },
  },
  {
    files: [
      'src/commissions/**/__tests__/**',
      'src/commissions/**/*.spec.ts',
      'src/commissions/**/test/**',
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        userText: true,
        engine: ADMIN_ENGINE_SYNTAX,
      }),
    },
  },
];

/** Shared flat config. Every app and package re-exports this from its own eslint.config.js. */
export const config = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-native/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
    ],
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
      'no-restricted-syntax': restrictedSyntax({ userText: false }),
    },
  },
  {
    // Tests assert the Arabic a user sees; the rule is about where the product keeps its text, not its tests.
    files: ['**/__tests__/**', '**/*.spec.ts', '**/test/**'],
    ...allowUserFacingText(),
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
  ...frontendConfig,
  prettier,
);

export default config;
