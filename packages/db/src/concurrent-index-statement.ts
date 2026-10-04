import { isSingleSqlStatement } from './single-sql-statement.ts';

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_$\u0080-\uffff]*)`;
const GAP = String.raw`(?:\s|--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*`;
const CREATE = new RegExp(
  `^${GAP}CREATE\\s+(UNIQUE\\s+)?INDEX\\s+CONCURRENTLY\\s+` +
    `(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENTIFIER})\\s+ON\\s+` +
    `(ONLY\\s+)?(${IDENTIFIER})(?:${GAP}\\.${GAP}(${IDENTIFIER}))?` +
    `(${GAP}(?:USING\\b|\\()[\\s\\S]*)$`,
  'i',
);
const PROTECTED = String.raw`[eE]'(?:[^'\\]|\\[\s\S]|'')*'|'(?:[^']|'')*'|\$(?<tag>[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\u0080-\uffff]*|)\$[\s\S]*?\$\k<tag>\$|--[^\n]*|/\*[\s\S]*?\*/`;
const QUALIFIED_COLUMN = new RegExp(
  PROTECTED +
    `|(?<schema>${IDENTIFIER})${GAP}\\.${GAP}(?<table>${IDENTIFIER})${GAP}\\.${GAP}(?=${IDENTIFIER})`,
  'g',
);
const TABLESPACE = new RegExp(
  PROTECTED +
    String.raw`|"(?:[^"]|"")+"|(?<predicate>\b[Ww][Hh][Ee][Rr][Ee]\b[\s\S]*)` +
    String.raw`|(?<open>\()|(?<close>\))` +
    String.raw`|(?<tablespace>\b[Tt][Aa][Bb][Ll][Ee][Ss][Pp][Aa][Cc][Ee]\s+` +
    IDENTIFIER +
    ')',
  'g',
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
  if (!isSingleSqlStatement(statement)) return undefined;
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
  let depth = 0;
  const definition = index.definition.replace(TABLESPACE, (...args: unknown[]) => {
    const groups = args.at(-1) as { tablespace?: string; open?: string; close?: string };
    if (groups.open) depth++;
    if (groups.close) depth--;
    // المشروع لا يحدد tablespace؛ المقارنة تتجاهل مكان التخزين ولا تحاول حله.
    return groups.tablespace && depth === 0 ? '' : (args[0] as string);
  });
  return definition.replace(QUALIFIED_COLUMN, (...args: unknown[]) => {
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
