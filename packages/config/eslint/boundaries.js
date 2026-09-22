import boundaries from 'eslint-plugin-boundaries';

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
    files: ['apps/**/*.ts', 'apps/**/*.tsx'],
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
    files: ['apps/**/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!@pospay/domain$|\\.{1,2}/).+',
              message: 'domain/ may import only @pospay/domain and its own files.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/**/modules/*/use-cases/**/*.ts'],
    rules: {
      // Node exposes fetch as a global, so an import ban alone would miss it.
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'use-cases/ reach the network only through a port.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(drizzle-orm|@nestjs/platform-.*|bullmq|ioredis|axios|node:.*|@pospay/db)(/.*)?$',
              message: 'use-cases/ reach infrastructure only through ports/ (CLAUDE.md §4.2).',
            },
          ],
        },
      ],
    },
  },
];
