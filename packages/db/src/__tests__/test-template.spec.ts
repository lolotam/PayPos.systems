import postgres from 'postgres';
import { expect, inject, it } from 'vitest';
import { pgUrl } from '../../test/pg-env.ts';

it('the migrated template has no sessions and refuses new connections before any file clones it', async () => {
  const pg = inject('pg');
  const maintenance = postgres(pgUrl(pg, pg.ownerUser, pg.ownerPassword, 'postgres'), { max: 1 });
  const template = postgres(pgUrl(pg, pg.ownerUser, pg.ownerPassword, pg.template), { max: 1 });
  try {
    const [row] = await maintenance`SELECT datallowconn,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=${pg.template}) AS sessions
      FROM pg_database WHERE datname=${pg.template}`;
    expect(row).toMatchObject({ datallowconn: false, sessions: 0 });
    await expect(template`SELECT 1`).rejects.toMatchObject({ code: '55000' });
  } finally {
    await Promise.all([template.end(), maintenance.end()]);
  }
});
