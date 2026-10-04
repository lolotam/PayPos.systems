import type postgres from 'postgres';

import {
  parseConcurrentIndex,
  probeDefinition,
  quoteIdentifier,
  tableReference,
  type ConcurrentIndexStatement,
} from './concurrent-index-statement.ts';

interface ExistingIndex {
  readonly oid: number;
  readonly valid: boolean | null;
  readonly tableOid: number | null;
}

async function signature(client: postgres.Sql | postgres.TransactionSql, oid: number) {
  const [row] = await client<{ definition: string }[]>`
    SELECT jsonb_build_object(
      'unique', i.indisunique, 'nullsNotDistinct', i.indnullsnotdistinct,
      'method', c.relam, 'keyCount', i.indnkeyatts,
      'operatorClasses', i.indclass::text, 'collations', i.indcollation::text,
      'sortOptions', i.indoption::text,
      'columnOptions', (SELECT jsonb_agg(a.attoptions ORDER BY a.attnum)
                        FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0),
      'columns', (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid, n, false) ORDER BY n)
                  FROM generate_series(1, i.indnatts) AS n),
      'predicate', pg_get_expr(i.indpred, i.indrelid, false),
      'options', (SELECT jsonb_agg(value ORDER BY value) FROM unnest(c.reloptions) AS value)
    )::text AS definition
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.oid = ${oid}`;
  if (!row) throw new Error('Concurrent index disappeared during definition comparison');
  return row.definition;
}

async function expectedSignature(
  client: postgres.Sql,
  index: ConcurrentIndexStatement,
  schema: string,
) {
  return client.begin(async (tx) => {
    // النسخة فارغة، فالمقارنة لا تبني index ثاني على البيانات الحية ولا توقف الكتابة عليها.
    // نفس اسم الجدول يسمح لـ predicates المولّدة من Drizzle بالإشارة إلى أعمدته المؤهلة.
    const table = quoteIdentifier(index.tableName);
    const probe =
      index.tableName === '__pospay_index_probe'
        ? '__pospay_index_probe_2'
        : '__pospay_index_probe';
    await tx.unsafe(
      `CREATE TEMP TABLE ${table} (LIKE ${quoteIdentifier(schema)}.${table}) ON COMMIT DROP`,
    );
    await tx.unsafe(
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(probe)} ` +
        `ON ${index.only ? 'ONLY ' : ''}pg_temp.${table} ${probeDefinition(index, schema)}`,
    );
    const [row] = await tx<{ oid: number }[]>`
      SELECT c.oid FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relname = ${probe}`;
    if (!row) throw new Error('Could not resolve concurrent index definition probe');
    return signature(tx, row.oid);
  });
}

async function hasActiveBuild(client: postgres.Sql, oid: number): Promise<boolean> {
  const [row] = await client<{ active: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_stat_progress_create_index
      WHERE datid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND index_relid = ${oid}
    ) OR EXISTS (
      SELECT 1 FROM pg_locks
      WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND relation = ${oid} AND pid IS DISTINCT FROM pg_backend_pid()
    ) AS active`;
  return row?.active === true;
}

/** يفك بقايا البناء المقطوع، ولا يقبل index صالحاً إلا إذا طابق التعريف المطلوب. */
export async function runConcurrentIndex(client: postgres.Sql, statement: string): Promise<void> {
  const index = parseConcurrentIndex(statement);
  if (!index) {
    throw new Error('Cannot safely resolve CREATE INDEX CONCURRENTLY statement');
  }
  const [table] = await client<{ oid: number; schema: string }[]>`
    SELECT c.oid, n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = to_regclass(${tableReference(index)})`;
  if (!table)
    throw new Error(`Concurrent index target table does not exist: ${tableReference(index)}`);
  const [existing] = await client<ExistingIndex[]>`
    SELECT c.oid, i.indisvalid AS valid, i.indrelid AS "tableOid"
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = ${table.schema} AND c.relname = ${index.indexName}::name`;
  const name = `${quoteIdentifier(table.schema)}.${quoteIdentifier(index.indexName)}`;
  // نتحقق من الجدول قبل إسقاط أي بقايا؛ الاسم وحده لا يثبت أنها تخص هذا migration.
  if (existing && existing.tableOid !== table.oid) {
    throw new Error(
      `Concurrent index ${name} already exists with a different definition; migration aborted (target table differs)`,
    );
  }
  if (existing?.valid === false) {
    // index غير صالح قد يكون قيد البناء الآن؛ لا نلغي عمل session أخرى.
    if (await hasActiveBuild(client, existing.oid)) {
      throw new Error(`Concurrent index ${name} has an active build or lock; retry later`);
    }
    await client.unsafe(`DROP INDEX CONCURRENTLY ${name}`);
  } else if (existing) {
    if (
      existing.valid !== true ||
      (await signature(client, existing.oid)) !==
        (await expectedSignature(client, index, table.schema))
    ) {
      throw new Error(
        `Concurrent index ${name} already exists with a different definition; migration aborted`,
      );
    }
    return;
  }
  await client.unsafe(statement);
}
