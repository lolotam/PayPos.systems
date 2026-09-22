import jsdoc from 'eslint-plugin-jsdoc';

/**
 * CLAUDE.md §3.1 — Arabic JSDoc is mandatory on domain/** and ports/**.
 * Scoped by `files` so the rule never fires on persistence/ or http/, where comments are banned noise.
 */
export const jsdocConfig = [
  {
    files: ['**/domain/**/*.ts', '**/ports/**/*.ts', 'packages/domain/src/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.test.ts'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ArrowFunctionExpression: true,
            MethodDefinition: true,
          },
          contexts: ['TSMethodSignature', 'TSPropertySignature > TSFunctionType'],
        },
      ],
      'jsdoc/require-description': 'error',
      'jsdoc/require-param': ['error', { contexts: ['FunctionDeclaration', 'TSMethodSignature'] }],
      'jsdoc/require-returns': ['error', { contexts: ['FunctionDeclaration'] }],
      'jsdoc/check-param-names': 'error',
      'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
    },
  },
  {
    // Every published event is a contract between modules; its comment says when it is emitted.
    files: ['**/events/published.ts'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: { FunctionDeclaration: false },
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'],
        },
      ],
      'jsdoc/require-description': 'error',
    },
  },
];
