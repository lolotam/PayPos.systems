import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

import { parseConcurrentIndex, probeDefinition } from '../concurrent-index-statement.ts';

it.each([
  ['CREATE INDEX CONCURRENTLY plain_idx ON things (id);', 'plain_idx', 'things', undefined, false],
  [
    'CREATE UNIQUE INDEX CONCURRENTLY "active_idx" ON "things" USING btree ("id") WHERE "things"."to" IS NULL;',
    'active_idx',
    'things',
    undefined,
    true,
  ],
  [
    '-- retry\nCREATE INDEX CONCURRENTLY "An ""Index" ON "Custom.Schema"."Some.Table" ("id");',
    'An "Index',
    'Some.Table',
    'Custom.Schema',
    false,
  ],
  [
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS Mixed_IDX ON App.Things (id);',
    'mixed_idx',
    'things',
    'app',
    false,
  ],
])(
  'resolves index identity without changing the definition: %s',
  (sql, indexName, tableName, tableSchema, unique) => {
    expect(parseConcurrentIndex(sql)).toMatchObject({ indexName, tableName, tableSchema, unique });
  },
);

it('preserves WHERE expressions and literals exactly', () => {
  const definition = `USING btree (id DESC NULLS LAST) WHERE label = 'ON "things"' AND "things"."to" IS NULL;`;
  expect(
    parseConcurrentIndex(`CREATE UNIQUE INDEX CONCURRENTLY idx ON public.things ${definition}`)
      ?.definition,
  ).toBe(definition);
});

it('rebinds schema-qualified columns for the probe while preserving literals and comments', () => {
  const definition = `("public"."things".id) WHERE public.things.label = 'public.things.id' AND public.things.label <> $test$public.things.id$test$ /* public.things.id */`;
  const parsed = parseConcurrentIndex(
    `CREATE INDEX CONCURRENTLY idx ON public.things ${definition}`,
  );
  expect(parsed).toBeDefined();
  if (!parsed) throw new Error('Expected concurrent CREATE');
  expect(probeDefinition(parsed, 'public')).toBe(
    `("things".id) WHERE "things".label = 'public.things.id' AND "things".label <> $test$public.things.id$test$ /* public.things.id */`,
  );
});

it('parses every concurrent CREATE statement in the immutable migration history', () => {
  const folder = new URL('../../migrations/', import.meta.url);
  const statements = readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .flatMap((name) =>
      readFileSync(new URL(name, folder), 'utf8').split('--> statement-breakpoint'),
    )
    .filter((sql) =>
      /^\s*(?:--[^\n]*\n\s*)*CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(sql),
    );
  expect(statements.length).toBeGreaterThanOrEqual(8);
  for (const sql of statements) expect(parseConcurrentIndex(sql)).toBeDefined();
});

it.each(['DROP INDEX CONCURRENTLY IF EXISTS idx', 'CREATE INDEX idx ON things (id)'])(
  'leaves other statement shapes alone: %s',
  (sql) => {
    expect(parseConcurrentIndex(sql)).toBeUndefined();
  },
);
