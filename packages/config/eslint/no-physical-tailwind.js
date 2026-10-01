const PHYSICAL =
  /^(?:-?(?:ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-.*|text-(?:left|right)|border-(?:l|r)(?:-.*)?|rounded-(?:l|r|tl|tr|bl|br)(?:-.*)?|(?:float|clear)-(?:left|right))$/;
// Arbitrary properties name the physical side directly, e.g. [padding-left:1rem] or [border-top-left-radius:2px].
const PHYSICAL_PROPERTY =
  /^\[(?:(?:margin|padding|scroll-margin|scroll-padding|border(?:-top|-bottom)?)-(?:left|right)[a-z-]*|left|right|(?:float|clear|text-align):(?:left|right)\]$)/;

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

function isPhysical(token) {
  const utility = utilityPart(token);
  return PHYSICAL.test(utility) || PHYSICAL_PROPERTY.test(utility);
}

const propertyName = (property) => property.key.name ?? property.key.value;

// In cva(), only the base classes, the variant values and a compound variant's class/className hold classes —
// variant names, default variants and compound selectors are names. In cn(), object keys are classes.
function isClassInCall(callee, path) {
  if (path.length === 0) return true;
  if (callee === 'cn') return path[0].role === 'key';
  if (path.some((step) => step.name === 'defaultVariants')) return false;
  if (path.some((step) => step.name === 'compoundVariants')) {
    return path[0].role === 'value' && ['class', 'className'].includes(path[0].name);
  }
  return path[0].role === 'value';
}

function isClassPosition(node) {
  const path = [];
  let child = node;
  for (let ancestor = node.parent; ancestor; child = ancestor, ancestor = ancestor.parent) {
    if (ancestor.type === 'JSXAttribute') return ancestor.name.name === 'className';
    if (ancestor.type === 'BinaryExpression') return false;
    if (ancestor.type === 'Property') {
      path.push({ role: child === ancestor.key ? 'key' : 'value', name: propertyName(ancestor) });
    }
    if (
      ancestor.type === 'CallExpression' &&
      ancestor.callee.type === 'Identifier' &&
      ['cn', 'cva'].includes(ancestor.callee.name)
    ) {
      return isClassInCall(ancestor.callee.name, path);
    }
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
      if (typeof value !== 'string' || !isClassPosition(node)) return;
      for (const className of value.split(/\s+/)) {
        if (isPhysical(className)) {
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
