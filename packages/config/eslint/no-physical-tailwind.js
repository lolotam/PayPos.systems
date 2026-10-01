const PHYSICAL =
  /^(?:-?(?:ml|mr|pl|pr|left|right|scroll-ml|scroll-mr)-.*|text-(?:left|right)|border-(?:l|r)(?:-.*)?|rounded-(?:l|r|tl|tr|bl|br)(?:-.*)?|float-(?:left|right))$/;

function utilityPart(token) {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index++) {
    const char = token[index];
    if (char === '[' || char === '(') depth++;
    if (char === ']' || char === ')') depth--;
    if (char === ':' && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!|!$/g, '');
}

function isClassContext(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.type === 'JSXAttribute' && ancestor.name.name === 'className') return true;
    if (
      ancestor.type === 'CallExpression' &&
      ancestor.callee.type === 'Identifier' &&
      ['cn', 'cva'].includes(ancestor.callee.name)
    )
      return true;
  }
  return false;
}

export const noPhysicalTailwind = {
  meta: {
    type: 'problem',
    docs: { description: 'Require logical Tailwind direction utilities for RTL layouts.' },
    schema: [],
    messages: {
      physical: 'Use a logical Tailwind utility instead of "{{className}}" (CLAUDE.md §7).',
    },
  },
  create(context) {
    function check(node, value) {
      if (typeof value !== 'string' || !isClassContext(node)) return;
      for (const className of value.split(/\s+/)) {
        if (PHYSICAL.test(utilityPart(className))) {
          context.report({ node, messageId: 'physical', data: { className } });
        }
      }
    }
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
