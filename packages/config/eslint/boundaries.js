import boundaries from 'eslint-plugin-boundaries';

import { CREDENTIAL_PATHS, CREDENTIAL_PATTERNS } from './credentials.js';

// ADR-0054 §1 — the commissions engine is a package, and the module-map check cannot see
// apps/admin or packages/*, so the ESLint scopes below are the enforcement layer (b).
/** The root entry: only the commissions module of apps/api and apps/worker may import it. */
export const COMMISSIONS_ENGINE_ROOT_BAN = {
  regex: '^@pospay/commissions-engine$',
  message:
    'The commissions engine is imported only by the commissions module of apps/api and apps/worker (ADR-0054 §1).',
};

/** Every subpath: the package exports "." and "./validation" only. */
export const COMMISSIONS_ENGINE_SUBPATH_BAN = {
  regex: '^@pospay/commissions-engine/.+$',
  message:
    'No subpath of @pospay/commissions-engine is importable; the package exports only "." and "./validation" (ADR-0054 §1).',
};

/** The admin app's replacement for the subpath ban: exactly one subpath is allowed. */
export const COMMISSIONS_ENGINE_VALIDATION_ONLY_BAN = {
  regex: '^@pospay/commissions-engine/(?!validation$).+$',
  message:
    'apps/admin may import only @pospay/commissions-engine/validation of the commissions engine (ADR-0054 §1).',
};

/** A relative specifier with a commissions-engine segment skips the exports map — no block lifts it. */
export const COMMISSIONS_ENGINE_PATH_BAN = {
  regex: '^\\.{1,2}/(?:.*/)?commissions-engine(?:/.*)?$',
  message:
    'The commissions engine is reached through its package exports, never through a relative path (ADR-0054 §1).',
};

/** The three bans every block that sets no-restricted-imports carries. */
export const COMMISSIONS_ENGINE_PATTERNS = [
  COMMISSIONS_ENGINE_ROOT_BAN,
  COMMISSIONS_ENGINE_SUBPATH_BAN,
  COMMISSIONS_ENGINE_PATH_BAN,
];

/** The use-cases/ infrastructure ban, composed back in wherever the rule is replaced. */
export const USE_CASES_INFRASTRUCTURE_PATTERN = {
  regex: '^(drizzle-orm|@nestjs/platform-.*|bullmq|ioredis|axios|node:.*|@pospay/db)(/.*)?$',
  message: 'use-cases/ reach infrastructure only through ports/ (CLAUDE.md §4.2).',
};

// import('…'), require('…') and import types of the engine — no-restricted-imports sees static imports only.
const ENGINE_ROOT = '/^@pospay\\/commissions-engine$/';
const ENGINE_SUBPATH = '/^@pospay\\/commissions-engine\\/.+$/';
const ENGINE_VALIDATION_ONLY = '/^@pospay\\/commissions-engine\\/(?!validation$).+$/';
const ENGINE_PATH = '/^\\.{1,2}\\/(?:.*\\/)?commissions-engine(?:\\/.*)?$/';

const engineSyntax = (pattern, message) => [
  { selector: `ImportExpression[source.value=${pattern}]`, message },
  { selector: `CallExpression[callee.name='require'][arguments.0.value=${pattern}]`, message },
  { selector: `TSImportType[argument.literal.value=${pattern}]`, message },
];

/** The dynamic-import, require() and import-type selectors of the engine's root entry. */
export const COMMISSIONS_ENGINE_ROOT_SYNTAX = engineSyntax(
  ENGINE_ROOT,
  COMMISSIONS_ENGINE_ROOT_BAN.message,
);

/** The dynamic-import, require() and import-type selectors of every engine subpath. */
export const COMMISSIONS_ENGINE_SUBPATH_SYNTAX = engineSyntax(
  ENGINE_SUBPATH,
  COMMISSIONS_ENGINE_SUBPATH_BAN.message,
);

/** The dynamic-import, require() and import-type selectors of every engine subpath but /validation. */
export const COMMISSIONS_ENGINE_VALIDATION_ONLY_SYNTAX = engineSyntax(
  ENGINE_VALIDATION_ONLY,
  COMMISSIONS_ENGINE_VALIDATION_ONLY_BAN.message,
);

/** The dynamic-import, require() and import-type selectors of a relative path into the engine. */
export const COMMISSIONS_ENGINE_PATH_SYNTAX = engineSyntax(
  ENGINE_PATH,
  COMMISSIONS_ENGINE_PATH_BAN.message,
);

/** The full engine ban, dynamic and static, for the blocks that lift nothing. */
export const COMMISSIONS_ENGINE_SYNTAX = [
  ...COMMISSIONS_ENGINE_ROOT_SYNTAX,
  ...COMMISSIONS_ENGINE_SUBPATH_SYNTAX,
  ...COMMISSIONS_ENGINE_PATH_SYNTAX,
];

/**
 * Layer rules inside a backend module — CLAUDE.md §2.2 and §4.2.
 * Every layer is an element; `default: 'disallow'` means any arrow not listed here fails lint.
 * Cross-module arrows are checked against docs/module-map.md by a separate gate (T12).
 */
const layer = (type) => ({
  type,
  pattern: `modules/*/${type}`,
  capture: ['module'],
});

const sameModule = (...types) => ({
  to: {
    element: {
      types: { anyOf: types },
      captured: { module: '{{ from.element.captured.module }}' },
    },
  },
});

const from = (type, ...allowed) => ({
  from: { element: { type } },
  allow: sameModule(...allowed),
});

export const boundariesConfig = [
  {
    // Globs are relative to the package being linted (each app runs eslint from its own folder), so they must not
    // start with apps/ — that prefix silently matched nothing and left every rule below unenforced.
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        layer('domain'),
        layer('use-cases'),
        layer('queries'),
        layer('ports'),
        layer('persistence'),
        layer('http'),
        layer('jobs'),
        layer('events'),
        // Must stay last: first match wins, so this only catches files at the module root
        // (index.ts and <module>.module.ts). Which of those may be imported is decided by
        // the entry-point rule below.
        { type: 'module-root', pattern: 'modules/*', capture: ['module'] },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        2,
        {
          default: 'disallow',
          policies: [
            from('domain', 'domain'),
            from('ports', 'ports', 'domain'),
            from('use-cases', 'use-cases', 'domain', 'ports', 'events'),
            from('queries', 'queries'),
            from('persistence', 'persistence', 'ports', 'domain'),
            // CLAUDE.md §4.1 — another module is reached only through its index.ts,
            // and only from the outer ring (CLAUDE.architecture.md §3.1, §6.2).
            {
              from: { element: { types: { anyOf: ['persistence', 'http', 'events'] } } },
              allow: { to: { element: { type: 'module-root' } } },
            },
            from('http', 'http', 'use-cases', 'queries'),
            from('jobs', 'jobs', 'use-cases', 'queries'),
            from('events', 'events', 'use-cases'),
            {
              from: { element: { type: 'module-root' } },
              allow: sameModule(
                'domain',
                'use-cases',
                'queries',
                'ports',
                'persistence',
                'http',
                'jobs',
                'events',
                'module-root',
              ),
            },
          ],
        },
      ],
      // CLAUDE.architecture.md §5.1 — index.ts is the module's only public surface.
      // A deep import of <module>.module.ts (or anything else) from another module fails here.
      'boundaries/entry-point': [
        2,
        {
          default: 'allow',
          policies: [
            { target: { type: 'module-root' }, allow: ['index.ts'] },
            { target: { type: 'module-root' }, disallow: ['!(index.ts)'] },
          ],
        },
      ],
    },
  },
  {
    // CLAUDE.architecture.md §3.1 and §10.1 — the inner rings never see infrastructure.
    files: ['**/modules/*/domain/**/*.ts'],
    // A domain unit test imports its runner; the purity rule is for the code under test.
    ignores: ['**/__tests__/**', '**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!@pospay/domain$|\\.{1,2}/).+',
              message: 'domain/ may import only @pospay/domain and its own files.',
            },
            // The engine stands in for the commissions domain/, so a domain/ file may never import it.
            ...COMMISSIONS_ENGINE_PATTERNS,
          ],
        },
      ],
    },
  },
  {
    files: ['**/modules/*/use-cases/**/*.ts'],
    rules: {
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
      // This replaces the base rule for use-cases/, so the credential ban is composed back in, not dropped.
      'no-restricted-imports': [
        'error',
        {
          paths: CREDENTIAL_PATHS,
          patterns: [
            ...CREDENTIAL_PATTERNS,
            USE_CASES_INFRASTRUCTURE_PATTERN,
            // The engine is refused here too; only the commissions layers lift it (ADR-0054 §1).
            ...COMMISSIONS_ENGINE_PATTERNS,
          ],
        },
      ],
    },
  },
];
