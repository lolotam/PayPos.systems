import type { TestProject } from 'vitest/node';
import postgres from 'postgres';

import { migrateDatabase } from '../src/migrations.ts';
import { pgUrl, readPgTestEnv, type PgTestEnv } from './pg-env.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: PgTestEnv & { readonly template: string; readonly runId: string };
  }
}

const TEST_DB = /^pospay_(test|tpl)_[a-z0-9_]+$/;

async function connectMaintenance(env: PgTestEnv): Promise<postgres.Sql> {
  const sql = postgres(pgUrl(env, env.ownerUser, env.ownerPassword, 'postgres'), {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    await sql`SELECT 1`;
  } catch (error) {
    await sql.end();
    throw new Error(
      `Postgres is not reachable on ${env.host}:${env.port} — run \`pnpm infra:up\``,
      {
        cause: error,
      },
    );
  }
  return sql;
}

// داتابيزات اختبار فضلت من تشغيلة وقعت. اللي عليها اتصال لسه شغال بتاعة تشغيلة تانية، فبنسيبها.
async function sweepLeftovers(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ datname: string }[]>`
    SELECT d.datname FROM pg_database d
    WHERE (d.datname LIKE 'pospay\\_test\\_%' OR d.datname LIKE 'pospay\\_tpl\\_%')
      AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)`;
  for (const { datname } of rows) {
    if (TEST_DB.test(datname)) await sql.unsafe(`DROP DATABASE IF EXISTS "${datname}"`);
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const env = readPgTestEnv();
  const runId = `${Date.now().toString(36)}_${process.pid}`;
  const template = `pospay_tpl_${runId}`;
  const sql = await connectMaintenance(env);
  await sweepLeftovers(sql);
  await sql.unsafe(`CREATE DATABASE "${template}"`);
  await migrateDatabase(pgUrl(env, env.ownerUser, env.ownerPassword, template), {
    app: env.appPassword,
    auth: env.authPassword,
  });
  project.provide('pg', { ...env, template, runId });

  return async () => {
    const clones = await sql<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE ${`pospay_test_${runId}_%`}`;
    for (const { datname } of [...clones, { datname: template }]) {
      if (TEST_DB.test(datname))
        await sql.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await sql.end();
  };
}
