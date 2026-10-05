import type { TestProject } from 'vitest/node';
import postgres from 'postgres';
import { setTimeout as delay } from 'node:timers/promises';

import { migrateDatabase } from '../src/migrations.ts';
import { pgUrl, readPgTestEnv, type PgTestEnv } from './pg-env.ts';
import { ROLE_TEST_LOCK } from './role-lock.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: PgTestEnv & { readonly template: string; readonly runId: string };
  }
}

const TEST_DB = /^pospay_(test|tpl)_[a-z0-9_]+$/;

async function connectMaintenance(env: PgTestEnv): Promise<postgres.Sql> {
  // الاتصال ده شايل الـ lock اللي بيثبت إن التشغيلة عايشة، فلازم يفضل مفتوح طول التشغيلة:
  // postgres.js بيقفل أي اتصال بعد 30–60 دقيقة افتراضياً، وده كان هيفك الـ lock في النص.
  const sql = postgres(pgUrl(env, env.ownerUser, env.ownerPassword, 'postgres'), {
    max: 1,
    max_lifetime: null,
    idle_timeout: 0,
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

// كل تشغيلة ماسكة lock باسم الـ runId بتاعها طول ما هي عايشة، على اتصال الصيانة.
// الـ template بيفضل من غير اتصالات بين نسخة والتانية، فغياب الاتصالات مش دليل إن التشغيلة ماتت —
// الدليل إننا نقدر ناخد الـ lock بتاعها.
const runLockKey = (runId: string): string => `pospay:test-run:${runId}`;

function runIdOf(datname: string): string | null {
  const match = /^pospay_(?:tpl_(.+)|test_(.+)_[0-9a-f]{8})$/.exec(datname);
  return match?.[1] ?? match?.[2] ?? null;
}

// داتابيزات فضلت من تشغيلات وقعت: بنمسح بس اللي تشغيلتها مش ماسكة الـ lock بتاعها.
async function sweepLeftovers(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ datname: string }[]>`
    SELECT datname FROM pg_database
    WHERE datname LIKE 'pospay\\_test\\_%' OR datname LIKE 'pospay\\_tpl\\_%'`;
  for (const { datname } of rows) {
    const runId = runIdOf(datname);
    if (runId === null || !TEST_DB.test(datname)) continue;
    const [lock] = await sql<{ free: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${runLockKey(runId)})) AS free`;
    if (lock?.free !== true) continue;
    try {
      await sql.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtext(${runLockKey(runId)}))`;
    }
  }
}

async function prepareTemplate(sql: postgres.Sql, env: PgTestEnv, template: string): Promise<void> {
  await sql.unsafe(`CREATE DATABASE "${template}"`);
  // الـ bootstrap بيشيل عضويات الـ roles، فلازم يستنى أي اختبار في تشغيلة تانية بيغيّرها (role-lock.ts).
  await sql`SELECT pg_advisory_lock(hashtext(${ROLE_TEST_LOCK}))`;
  try {
    await migrateDatabase(pgUrl(env, env.ownerUser, env.ownerPassword, template), {
      app: env.appPassword,
      auth: env.authPassword,
      dispatcher: env.dispatcherPassword,
      notifications: env.notificationsPassword,
    });
  } finally {
    await sql`SELECT pg_advisory_unlock(hashtext(${ROLE_TEST_LOCK}))`;
  }
  // القالب للاستنساخ فقط بعد إغلاق pool الـ migrations؛ أي helper يتصل به خطأً يرفض فوراً.
  await sql.unsafe(`ALTER DATABASE "${template}" ALLOW_CONNECTIONS false`);
  // إغلاق العميل يسبق أحياناً اختفاء backend من pg_stat_activity؛ ننتظر التصريف فقط بحد ثانيتين.
  for (let attempt = 0; attempt < 20; attempt++) {
    const [remaining] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=${template}`;
    if (remaining?.count === 0) return;
    await delay(100);
  }
  throw new Error('Test template migration connections were not closed');
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const env = readPgTestEnv();
  const runId = `${Date.now().toString(36)}_${process.pid}`;
  const template = `pospay_tpl_${runId}`;
  const sql = await connectMaintenance(env);
  try {
    // الـ lock ده بيتفك لوحده لما الاتصال يقفل — حتى لو التشغيلة وقعت من غير teardown.
    await sql`SELECT pg_advisory_lock(hashtext(${runLockKey(runId)}))`;
    await sweepLeftovers(sql);
    await prepareTemplate(sql, env, template);
  } catch (error) {
    await sql.end();
    throw error;
  }
  project.provide('pg', { ...env, template, runId });

  return async () => {
    try {
      const clones = await sql<{ datname: string }[]>`
        SELECT datname FROM pg_database WHERE datname LIKE ${`pospay_test_${runId}_%`}`;
      for (const { datname } of [...clones, { datname: template }]) {
        if (TEST_DB.test(datname))
          await sql.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
      }
    } finally {
      await sql.end();
    }
  };
}
