const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[a-z_\u0080-\uffff][a-z0-9_$\u0080-\uffff]*)`;
const GAP = String.raw`(?:\s|--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*`;
const CREATE = new RegExp(
  `^${GAP}CREATE\\s+(UNIQUE\\s+)?INDEX\\s+CONCURRENTLY\\s+` +
    `(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENTIFIER})\\s+ON\\s+` +
    `(ONLY\\s+)?(${IDENTIFIER})(?:${GAP}\\.${GAP}(${IDENTIFIER}))?` +
    `(${GAP}(?:USING\\b|\\()[\\s\\S]*)$`,
  'i',
);
const QUALIFIED_COLUMN = new RegExp(
  String.raw`E'(?:[^'\\]|\\[\s\S]|'')*'|'(?:[^']|'')*'|\$(?<tag>[a-z_0-9]*)\$[\s\S]*?\$\k<tag>\$|--[^\n]*|/\*[\s\S]*?\*/` +
    `|(?<schema>${IDENTIFIER})${GAP}\\.${GAP}(?<table>${IDENTIFIER})${GAP}\\.${GAP}(?=${IDENTIFIER})`,
  'gi',
);

export interface ConcurrentIndexStatement {
  readonly indexName: string;
  readonly tableName: string;
  readonly tableSchema: string | undefined;
  readonly unique: boolean;
  readonly only: boolean;
  readonly definition: string;
}

function identifier(value: string): string {
  return value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value.toLowerCase();
}

/** بيحفظ نص الـ predicate كما هو؛ PostgreSQL هو اللي يقارن التعريف بعد تحليله. */
export function parseConcurrentIndex(statement: string): ConcurrentIndexStatement | undefined {
  const match = CREATE.exec(statement);
  if (!match) return undefined;
  const table = match[5] ?? match[4];
  if (!table || !match[2] || !match[6]) return undefined;
  return {
    indexName: identifier(match[2]),
    tableName: identifier(table),
    tableSchema: match[5] ? identifier(match[4] ?? '') : undefined,
    unique: Boolean(match[1]),
    only: Boolean(match[3]),
    definition: match[6].trim(),
  };
}

export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function tableReference(index: ConcurrentIndexStatement): string {
  return [index.tableSchema, index.tableName]
    .filter((name): name is string => name !== undefined)
    .map(quoteIdentifier)
    .join('.');
}

/** تأهيل schema في الأعمدة يشير للنسخة المؤقتة فقط، من غير تغيير النصوص أو الدوال. */
export function probeDefinition(index: ConcurrentIndexStatement, schema: string): string {
  return index.definition.replace(QUALIFIED_COLUMN, (...args: unknown[]) => {
    const match = args[0] as string;
    const groups = args.at(-1) as { schema?: string; table?: string };
    return groups.schema &&
      groups.table &&
      identifier(groups.schema) === schema &&
      identifier(groups.table) === index.tableName
      ? `${quoteIdentifier(index.tableName)}.`
      : match;
  });
}
