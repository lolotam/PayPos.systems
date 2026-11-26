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
  COMMISSIONS_POSTING_FACTORY_PATH,
  COMMISSIONS_POSTING_FACTORY_SYNTAX,
  COMMISSIONS_POSTING_PATH_BAN,
  COMMISSIONS_POSTING_PATH_SYNTAX,
  COMMISSIONS_POSTING_PATTERNS,
  COMMISSIONS_POSTING_SUBPATH_BAN,
  COMMISSIONS_POSTING_SUBPATH_SYNTAX,
  COMMISSIONS_POSTING_SYNTAX,
  COMMISSIONS_UNANALYSABLE_SYNTAX,
  DATABASE_RUNTIME_SUBPATH_BAN,
  DATABASE_RUNTIME_SYNTAX,
  USE_CASES_INFRASTRUCTURE_PATTERN,
} from './boundaries.js';
import {
  CREDENTIAL_PATHS,
  CREDENTIAL_PATTERNS,
  CREDENTIAL_SYNTAX,
  OPERATOR_PATTERNS,
  OPERATOR_SYNTAX,
} from './credentials.js';
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
  createPlatformEmailDatabase:
    'the email feedback facade is wired only by API/worker roots (ADR-0014 addendum).',
};
// The two restricted commissions packages (ADR-0054 §1 and its addendum): every block carries both sets of bans.
const RESTRICTED_PACKAGE_PATTERNS = [
  ...COMMISSIONS_ENGINE_PATTERNS,
  ...COMMISSIONS_POSTING_PATTERNS,
];

const facadeRule = (
  allowed,
  credentials = false,
  engine = RESTRICTED_PACKAGE_PATTERNS,
  operator = false,
  runtimeDatabase = false,
) => [
  'error',
  {
    paths: [
      // A layer that may not touch the database runtime refuses runtime imports while types stay allowed.
      ...(runtimeDatabase ? [{ name: '@pospay/db', allowTypeImports: true }] : []),
      ...Object.entries(FACADES)
        .filter(([name]) => !(Array.isArray(allowed) ? allowed : [allowed]).includes(name))
        .map(([name, message]) => ({ name: '@pospay/db', importNames: [name], message })),
      ...(credentials ? [] : CREDENTIAL_PATHS),
    ],
    patterns: [
      ...(credentials ? [] : CREDENTIAL_PATTERNS),
      ...(operator ? [] : OPERATOR_PATTERNS),
      ...(runtimeDatabase ? [DATABASE_RUNTIME_SUBPATH_BAN] : []),
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
      RESTRICTED_PACKAGE_PATTERNS,
      options.operator === true,
    ),
    ...(options.operator === true
      ? { 'no-restricted-syntax': restrictedSyntax({ userText: false, operator: false }) }
      : {}),
  },
});

/**
 * The override for a layer that may name @pospay/db as types only: runtime imports (root and subpaths)
 * are refused there, while the credential, operator and restricted-package bans stay.
 *
 * @param {{ userText?: boolean }} [options] userText lifts the Arabic-text ban for a test file
 * @returns {import('eslint').Linter.Config} the override
 */
export const banRuntimeDatabaseImport = ({ userText = false } = {}) => ({
  rules: {
    'no-restricted-imports': facadeRule(null, false, RESTRICTED_PACKAGE_PATTERNS, false, true),
    // #1334 — the runtime of @pospay/db is refused in import(), require() and `import x = require()` too.
    // `import type` and `typeof import('@pospay/db')` stay allowed because they name no runtime.
    'no-restricted-syntax': restrictedSyntax({ userText, extra: DATABASE_RUNTIME_SYNTAX }),
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

const restrictedSyntax = ({
  userText,
  engine = [...COMMISSIONS_ENGINE_SYNTAX, ...COMMISSIONS_POSTING_SYNTAX],
  operator = true,
  extra = [],
}) => [
  'error',
  ...CREDENTIAL_SYNTAX,
  ...engine,
  ...extra,
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

// ADR-0054 §1 addendum — the apps' commissions layers lift the posting root as well; the posting package itself
// keeps its own root refused (it never imports itself).
const APP_RESTRICTED_SYNTAX = [
  ...BACKEND_ENGINE_SYNTAX,
  ...COMMISSIONS_POSTING_SUBPATH_SYNTAX,
  ...COMMISSIONS_POSTING_PATH_SYNTAX,
];
const POSTING_RESTRICTED_SYNTAX = [...BACKEND_ENGINE_SYNTAX, ...COMMISSIONS_POSTING_SYNTAX];

// The module's wiring file and its tests lift the posting root only: they bind the step's adapter and exercise it,
// and the engine root stays refused there (ADR-0054 §1 addendum).
const WIRING_RESTRICTED = [
  ...COMMISSIONS_ENGINE_PATTERNS,
  COMMISSIONS_POSTING_SUBPATH_BAN,
  COMMISSIONS_POSTING_PATH_BAN,
];
const WIRING_SYNTAX = [
  ...COMMISSIONS_ENGINE_SYNTAX,
  ...COMMISSIONS_POSTING_SUBPATH_SYNTAX,
  ...COMMISSIONS_POSTING_PATH_SYNTAX,
];

// ADR-0054 §1 — the admin area allows the browser-safe /validation entry point and nothing else.
const ADMIN_ENGINE_SYNTAX = [
  ...COMMISSIONS_ENGINE_ROOT_SYNTAX,
  ...COMMISSIONS_ENGINE_VALIDATION_ONLY_SYNTAX,
  ...COMMISSIONS_ENGINE_PATH_SYNTAX,
  ...COMMISSIONS_POSTING_SYNTAX,
];

/** A no-restricted-imports rule with more paths, for the layers that carry the scope-factory guard. */
const withPaths = (rule, paths) => [rule[0], { ...rule[1], paths: [...rule[1].paths, ...paths] }];

/**
 * The four blocks of a commissions module's layers that lift a restricted package's root entry: the
 * use-cases/, ports/ and persistence/ — the layers CLAUDE.architecture.md §3.1 lets import a module's
 * own domain/ — and nothing else. Each block re-lists its layer's patterns, because a later block replaces
 * the whole rule, and comes as a pair with its test files so tests keep the Arabic-text exemption.
 *
 * @param {string} prefix the glob of the folder that holds the layers
 * @param {{ regex: string, message: string }[]} restricted the bans every block keeps: the engine's
 *   subpath and path, and the posting package's bans minus the root where the root is lifted
 * @param {unknown[]} syntax the matching dynamic-import selectors
 * @param {{ paths: unknown[], syntax: unknown[] }} [useCaseGuards] extra bans of the use-cases/ and ports/ layers only
 * @returns {import('eslint').Linter.Config[]} the four blocks of the layers
 */
const commissionsLayerBlocks = (
  prefix,
  restricted,
  syntax,
  useCaseGuards = { paths: [], syntax: [] },
) => [
  {
    // ADR-0054 §1 — the commissions use-cases/ lift the root entry and nothing else.
    files: [`${prefix}/use-cases/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...CREDENTIAL_PATHS, ...useCaseGuards.paths],
          patterns: [
            ...CREDENTIAL_PATTERNS,
            ...OPERATOR_PATTERNS,
            USE_CASES_INFRASTRUCTURE_PATTERN,
            ...restricted,
          ],
        },
      ],
      'no-restricted-syntax': restrictedSyntax({
        userText: false,
        engine: [...syntax, ...useCaseGuards.syntax],
      }),
    },
  },
  {
    // ADR-0054 §1 — a commissions use-case test keeps the Arabic-text exemption.
    files: [
      `${prefix}/use-cases/**/__tests__/**`,
      `${prefix}/use-cases/__tests__/**`,
      `${prefix}/use-cases/**/*.spec.ts`,
      `${prefix}/use-cases/**/test/**`,
      `${prefix}/use-cases/test/**`,
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        userText: true,
        engine: [...syntax, ...useCaseGuards.syntax],
      }),
    },
  },
  {
    // ADR-0054 §1 — the commissions persistence/ lifts the root entry only.
    files: [`${prefix}/persistence/**/*.ts`],
    rules: {
      'no-restricted-imports': facadeRule(null, false, restricted),
      'no-restricted-syntax': restrictedSyntax({ userText: false, engine: syntax }),
    },
  },
  {
    // #1217 — a port may import the posting root, so it carries the use cases' guards: a re-export of the scope
    // factory from here would hand it to every use case, which may import ports/.
    files: [`${prefix}/ports/**/*.ts`],
    rules: {
      'no-restricted-imports': withPaths(facadeRule(null, false, restricted), useCaseGuards.paths),
      'no-restricted-syntax': restrictedSyntax({
        userText: false,
        engine: [...syntax, ...useCaseGuards.syntax],
      }),
    },
  },
  {
    // ADR-0054 §1 — a commissions port or persistence test keeps the Arabic-text exemption.
    files: [
      `${prefix}/ports/**/__tests__/**`,
      `${prefix}/ports/__tests__/**`,
      `${prefix}/ports/**/*.spec.ts`,
      `${prefix}/ports/**/test/**`,
      `${prefix}/ports/test/**`,
      `${prefix}/persistence/**/__tests__/**`,
      `${prefix}/persistence/__tests__/**`,
      `${prefix}/persistence/**/*.spec.ts`,
      `${prefix}/persistence/**/test/**`,
      `${prefix}/persistence/test/**`,
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntax({ userText: true, engine: syntax }),
    },
  },
  {
    // #1217 — a commissions port test keeps the Arabic-text exemption and the use cases' guards.
    files: [
      `${prefix}/ports/**/__tests__/**`,
      `${prefix}/ports/__tests__/**`,
      `${prefix}/ports/**/*.spec.ts`,
      `${prefix}/ports/**/test/**`,
      `${prefix}/ports/test/**`,
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        userText: true,
        engine: [...syntax, ...useCaseGuards.syntax],
      }),
    },
  },
];

/**
 * The blocks that let a commissions module's wiring file and its module-level tests import the correction
 * step's root entry (ADR-0054 §1 addendum): `<module>.module.ts` binds the step's adapter, and `__tests__/`
 * builds the projectors on it. The engine root stays refused in both.
 *
 * @param {string} prefix the glob of the module folder
 * @param {keyof typeof FACADES | (keyof typeof FACADES)[] | null} facades the database facade the app owns, which a block that
 *   replaces the rule must keep allowing
 * @returns {import('eslint').Linter.Config[]} the two blocks
 */
const commissionsWiringBlocks = (prefix, facades) => [
  {
    files: [`${prefix}/commissions.module.ts`],
    rules: {
      'no-restricted-imports': facadeRule(facades, false, WIRING_RESTRICTED),
      'no-restricted-syntax': restrictedSyntax({ userText: false, engine: WIRING_SYNTAX }),
    },
  },
  {
    files: [`${prefix}/__tests__/**`],
    rules: {
      'no-restricted-imports': facadeRule(facades, false, WIRING_RESTRICTED),
      'no-restricted-syntax': restrictedSyntax({ userText: true, engine: WIRING_SYNTAX }),
    },
  },
];

/**
 * The override for the backend apps whose commissions module may import the engine root and the
 * correction step's root (ADR-0054 §1 and its addendum): apps/api and apps/worker append it. Both roots
 * are lifted in the commissions use-cases/, ports/ and persistence/; the wiring file and the module-level
 * tests lift the correction step's root only.
 *
 * @param {{ facades?: keyof typeof FACADES | (keyof typeof FACADES)[] }} [options] the database facade the app
 *   owns, so the wiring and test blocks do not take its allowance away
 * @returns {import('eslint').Linter.Config[]} the blocks of the commissions layers and wiring
 */
export const allowCommissionsEngineBackend = (options = {}) => [
  ...commissionsLayerBlocks(
    '**/modules/commissions',
    [
      COMMISSIONS_ENGINE_SUBPATH_BAN,
      COMMISSIONS_ENGINE_PATH_BAN,
      COMMISSIONS_POSTING_SUBPATH_BAN,
      COMMISSIONS_POSTING_PATH_BAN,
    ],
    APP_RESTRICTED_SYNTAX,
    {
      paths: [COMMISSIONS_POSTING_FACTORY_PATH],
      syntax: [...COMMISSIONS_POSTING_FACTORY_SYNTAX, ...COMMISSIONS_UNANALYSABLE_SYNTAX],
    },
  ),
  ...commissionsWiringBlocks('**/modules/commissions', options.facades ?? null),
];

/**
 * The override of packages/commissions-posting, the one package besides the apps' commissions modules that
 * may import the engine root (ADR-0054 §1 addendum, PP-226): its use-cases/, ports/ and persistence/ lift the
 * engine root exactly as a commissions module does, keep the posting package's own bans, and its domain/ stays
 * as bound as any module's.
 *
 * @returns {import('eslint').Linter.Config[]} the four blocks of the package's layers
 */
export const allowCommissionsEnginePackage = () =>
  commissionsLayerBlocks(
    'src',
    [COMMISSIONS_ENGINE_SUBPATH_BAN, COMMISSIONS_ENGINE_PATH_BAN, ...COMMISSIONS_POSTING_PATTERNS],
    POSTING_RESTRICTED_SYNTAX,
  );

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
        ...COMMISSIONS_POSTING_PATTERNS,
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
