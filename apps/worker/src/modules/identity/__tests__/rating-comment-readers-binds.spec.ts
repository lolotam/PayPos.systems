import { PgDialect } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import { ratingCommentReadersStatement } from '../persistence/rating-comment-readers.ts';

const POSTGRES_PARAMETER_LIMIT = 65_535;
const AT = new Date('2026-06-01T00:00:00.000Z');
const ids = Array.from(
  { length: 70_000 },
  (_, n) => `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`,
);

it('binds the candidate users as one parameter however many there are, under the PostgreSQL limit', () => {
  const company = '01920000-0000-7000-8000-0000000000a0';
  const render = (users: readonly string[]) =>
    new PgDialect().sqlToQuery(ratingCommentReadersStatement(company, company, company, AT, users));
  const rendered = render(ids);
  expect(rendered.params.length).toBeLessThan(POSTGRES_PARAMETER_LIMIT);
  expect(rendered.params.length).toBe(render(ids.slice(0, 3)).params.length);
  const lists = rendered.params.filter(
    (param): param is string => typeof param === 'string' && param.startsWith('{'),
  );
  expect(lists.length).toBeGreaterThan(0);
  for (const list of lists) expect(list).toBe(`{${ids.join(',')}}`);
});
