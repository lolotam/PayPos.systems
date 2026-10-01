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
const COMPARISON = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'in', 'instanceof']);

// A class value in clsx form: a string, or an object whose keys are classes (its values are conditions).
const isClassValue = (inner) => inner.length === 0 || inner[0].role === 'key';

// cva(base, config): the base is a class value; in the config, a variant option's value and a compound variant's
// class/className are class values. Variant names, option names, default variants and selectors are names.
function isClassInCva(argumentIndex, path) {
  if (argumentIndex === 0) return isClassValue(path);
  const variants = path.findIndex((step) => step.name === 'variants' && step.role === 'value');
  if (variants >= 2) {
    const option = variants - 2;
    return path[option].role === 'value' && isClassValue(path.slice(0, option));
  }
  if (!path.some((step) => step.name === 'compoundVariants')) return false;
  const field = path.findIndex((step) => ['class', 'className'].includes(step.name));
  return field >= 0 && path[field].role === 'value' && isClassValue(path.slice(0, field));
}

function isClassPosition(node) {
  const path = [];
  let child = node;
  for (let ancestor = node.parent; ancestor; child = ancestor, ancestor = ancestor.parent) {
    if (ancestor.type === 'JSXAttribute') return ancestor.name.name === 'className';
    if (ancestor.type === 'BinaryExpression' && COMPARISON.has(ancestor.operator)) return false;
    if (ancestor.type === 'MemberExpression' && child === ancestor.property) return false;
    if (ancestor.type === 'Property') {
      path.push({ role: child === ancestor.key ? 'key' : 'value', name: propertyName(ancestor) });
    }
    if (ancestor.type === 'CallExpression' && ancestor.callee.type === 'Identifier') {
      if (ancestor.callee.name === 'cn') return isClassValue(path);
      if (ancestor.callee.name === 'cva')
        return isClassInCva(ancestor.arguments.indexOf(child), path);
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
