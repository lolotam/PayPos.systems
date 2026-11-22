import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * The purity rule of a package that runs in the browser: it may import only its own files and the
 * packages it names. A static import pattern cannot see a dynamic import(), a require() or an
 * import type, and a relative specifier that leaves the package's src folder, so every specifier is
 * resolved here against the importing file instead of being matched by its spelling.
 *
 * @param {{ src: string, packages?: string[], folders?: string[], typeOnlyPackages?: string[], relativeTypeOnly?: boolean, message: string }} options
 *   src: the absolute path of the package's src folder; packages: the package names it may import;
 *   folders: when given, a relative import must also land inside one of these first-level folders of src
 *   (a layer rule for a package that is not a module); typeOnlyPackages: packages in `packages` that may be imported
 *   as types only (`import type`, `export type`, an import type), never as a runtime value; relativeTypeOnly: the same
 *   for every relative import (a layer that declares interfaces only); message: the text of the report.
 * @returns {import('eslint').Rule.RuleModule} the rule
 */
export const ownFilesOnly = ({
  src,
  packages = [],
  folders,
  typeOnlyPackages = [],
  relativeTypeOnly = false,
  message,
}) => ({
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      outside: message,
    },
  },
  create(context) {
    const check = (source, isType = false) => {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') {
        if (source) context.report({ node: source, messageId: 'outside' });
        return;
      }
      if (!source.value.startsWith('.')) {
        if (!packages.includes(source.value)) {
          context.report({ node: source, messageId: 'outside' });
        } else if (!isType && typeOnlyPackages.includes(source.value)) {
          context.report({ node: source, messageId: 'outside' });
        }
        return;
      }
      const target = relative(src, resolve(dirname(context.filename), source.value));
      if (target.startsWith('..') || isAbsolute(target)) {
        context.report({ node: source, messageId: 'outside' });
        return;
      }
      if (folders !== undefined && !folders.includes(target.split(sep)[0])) {
        context.report({ node: source, messageId: 'outside' });
      } else if (relativeTypeOnly && !isType) {
        context.report({ node: source, messageId: 'outside' });
      }
    };
    const checkRequire = (node) => {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
      const [argument] = node.arguments;
      if (argument === undefined) return;
      check(argument);
    };
    // Only the declaration-level form is type-only: under verbatimModuleSyntax `import { type A } from 'x'` still
    // emits `import {} from 'x'`, a runtime import.
    return {
      ImportDeclaration: (node) => check(node.source, node.importKind === 'type'),
      ExportNamedDeclaration: (node) => check(node.source, node.exportKind === 'type'),
      ExportAllDeclaration: (node) => check(node.source, node.exportKind === 'type'),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.argument?.literal, true),
      // `import x = require('y')` is its own node, not an ImportDeclaration or a CallExpression.
      TSImportEqualsDeclaration: (node) => {
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          check(node.moduleReference.expression, node.importKind === 'type');
        }
      },
      CallExpression: checkRequire,
    };
  },
});
