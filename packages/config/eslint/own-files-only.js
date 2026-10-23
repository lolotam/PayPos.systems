import { dirname, isAbsolute, relative, resolve } from 'node:path';

/**
 * The purity rule of a package that runs in the browser: it may import only its own files and the
 * packages it names. A static import pattern cannot see a dynamic import() or a require(), and a
 * relative specifier that leaves the package's src folder, so every specifier is resolved here
 * against the importing file instead of being matched by its spelling.
 *
 * @param {{ src: string, packages?: string[], message: string }} options
 *   src: the absolute path of the package's src folder; packages: the package names it may import;
 *   message: the text of the report.
 * @returns {import('eslint').Rule.RuleModule} the rule
 */
export const ownFilesOnly = ({ src, packages = [], message }) => ({
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      outside: message,
    },
  },
  create(context) {
    const check = (source) => {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') {
        if (source) context.report({ node: source, messageId: 'outside' });
        return;
      }
      if (!source.value.startsWith('.')) {
        if (!packages.includes(source.value)) {
          context.report({ node: source, messageId: 'outside' });
        }
        return;
      }
      const target = relative(src, resolve(dirname(context.filename), source.value));
      if (target.startsWith('..') || isAbsolute(target)) {
        context.report({ node: source, messageId: 'outside' });
      }
    };
    const checkRequire = (node) => {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
      const [argument] = node.arguments;
      if (argument === undefined) return;
      check(argument);
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression: checkRequire,
    };
  },
});
