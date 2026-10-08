import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const roots = ['../../../../api/src/', '../../'].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
);

function stringValues(type: ts.Type): string[] {
  if (type.isStringLiteral()) return [type.value];
  if (type.isUnion()) return type.types.flatMap(stringValues);
  throw new Error('Event type must resolve to a finite set of string literals');
}

function expressionValues(expression: ts.Expression, checker: ts.TypeChecker): string[] {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isConditionalExpression(expression)) {
    return [
      ...expressionValues(expression.whenTrue, checker),
      ...expressionValues(expression.whenFalse, checker),
    ];
  }
  // TypeScript يوسّع نوع القالب إلى string أحياناً؛ نستخرج كل احتمال من نوع كل تعبير داخله.
  if (ts.isTemplateExpression(expression)) {
    return expression.templateSpans.reduce(
      (prefixes, span) =>
        prefixes.flatMap((prefix) =>
          expressionValues(span.expression, checker).map(
            (value) => `${prefix}${value}${span.literal.text}`,
          ),
        ),
      [expression.head.text],
    );
  }
  return stringValues(checker.getTypeAtLocation(expression));
}

export function emittedEventTypes(): Map<string, string[]> {
  const files = roots.flatMap((root) =>
    ts.sys.readDirectory(
      root,
      ['.ts', '.tsx'],
      ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**', '**/test/**', '**/fixtures/**'],
    ),
  );
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const events = new Map<string, string[]>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error(`Source not loaded: ${file}`);
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(source).replace(/['"]/g, '') === 'eventType'
      ) {
        const location = `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        let values: string[];
        try {
          values = expressionValues(node.initializer, checker);
        } catch (cause) {
          throw new Error(`Cannot enumerate eventType at ${location}`, { cause });
        }
        for (const value of values) events.set(value, [...(events.get(value) ?? []), location]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return events;
}
