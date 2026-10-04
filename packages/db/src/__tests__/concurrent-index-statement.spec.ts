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

it.each([
  '(id); SELECT 1',
  '(id); /* suffix */ CREATE TABLE side_effect (id int)',
  '(id); -- suffix\nINSERT INTO side_effect VALUES (1);',
  '(id); -- suffix\rINSERT INTO side_effect VALUES (1);',
  '(id);;',
  "(id) WHERE label = 'unterminated",
  '(id) WHERE label = $Tag$unterminated$tag$',
])('rejects extra statements and unterminated literals: %s', (definition) => {
  expect(
    parseConcurrentIndex(`CREATE INDEX CONCURRENTLY idx ON things ${definition}`),
  ).toBeUndefined();
});

it('ends leading and predicate line comments at a carriage return', () => {
  const parsed = parseConcurrentIndex(
    '-- leading\rCREATE INDEX CONCURRENTLY idx ON public.things (id) WHERE -- predicate\rpublic.things.label IS NULL',
  );
  if (!parsed) throw new Error('Expected concurrent CREATE');
  expect(probeDefinition(parsed, 'public')).toBe('(id) WHERE -- predicate\r"things".label IS NULL');
});

it.each([
  `(id) WHERE label = '; SELECT 1'`,
  `(id) WHERE label = E'escaped\\'; SELECT 1'`,
  '(id) WHERE label = $Tag$; $tag$; SELECT 1$Tag$',
  '("id;"); /* outer /* nested ; */ comment */',
])('accepts semicolons inside protected SQL text: %s', (definition) => {
  expect(
    parseConcurrentIndex(
      `/* leading */ -- retry\nCREATE INDEX CONCURRENTLY idx ON things ${definition}`,
    ),
  ).toBeDefined();
});

it('preserves mixed-case dollar-quoted contents when rebinding the definition probe', () => {
  const definition =
    '(id) WHERE public.things.label = $Tag$before $tag$ public.things.id; TABLESPACE elsewhere $Tag$';
  const parsed = parseConcurrentIndex(`CREATE INDEX CONCURRENTLY idx ON things ${definition}`);
  if (!parsed) throw new Error('Expected concurrent CREATE');
  expect(probeDefinition(parsed, 'public')).toBe(
    '(id) WHERE "things".label = $Tag$before $tag$ public.things.id; TABLESPACE elsewhere $Tag$',
  );
});

it('omits the tablespace clause from the probe while preserving predicate text', () => {
  const parsed = parseConcurrentIndex(
    `CREATE INDEX CONCURRENTLY idx ON things (id) TABLESPACE "Custom.Space" WHERE label = 'TABLESPACE elsewhere' AND tablespace IS NULL;`,
  );
  if (!parsed) throw new Error('Expected concurrent CREATE');
  expect(probeDefinition(parsed, 'public')).toBe(
    `(id)  WHERE label = 'TABLESPACE elsewhere' AND tablespace IS NULL;`,
  );
});

it('preserves expressions using a column named tablespace', () => {
  const parsed = parseConcurrentIndex(
    'CREATE INDEX CONCURRENTLY idx ON things ((tablespace IS NULL)) TABLESPACE pg_default',
  );
  if (!parsed) throw new Error('Expected concurrent CREATE');
  expect(probeDefinition(parsed, 'public')).toBe('((tablespace IS NULL)) ');
});
