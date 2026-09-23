import { randomBytes } from 'node:crypto';

import postgres from 'postgres';
import { inject } from 'vitest';

import { pgUrl } from './pg-env.ts';

/**
 * داتابيز معزولة لملف اختبار واحد، متنسخة من الـ template اللي عليه كل الـ migrations.
 */
export interface TestDatabase {
  readonly name: string;
  readonly appUrl: string;
  readonly authUrl: string;
  readonly ownerUrl: string;
  drop(): Promise<void>;
}

/**
 * بينسخ الـ template لداتابيز جديدة. الـ URLs التلاتة جاهزة: الاختبارات بتشتغل كـ pospay_app،
 * والـ owner للتجهيز بس.
 *
 * @returns الداتابيز والـ URLs ودالة المسح
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = inject('pg');
  const name = `pospay_test_${pg.runId}_${randomBytes(4).toString('hex')}`;
  const maintenance = postgres(pgUrl(pg, pg.ownerUser, pg.ownerPassword, 'postgres'), {
    max: 1,
    onnotice: () => undefined,
  });
  // CREATE DATABASE ... TEMPLATE بيفشل لو ملفين نسخوا في نفس اللحظة، فبنعمله واحد ورا التاني.
  // الـ lock على مستوى الـ session (مش transaction) لأن CREATE DATABASE مينفعش جوه transaction،
  // و max: 1 بيضمن إن الـ lock والـ CREATE على نفس الاتصال.
  await maintenance`SELECT pg_advisory_lock(hashtext('pospay:clone-template'))`;
  try {
    await maintenance.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${pg.template}"`);
  } finally {
    await maintenance`SELECT pg_advisory_unlock(hashtext('pospay:clone-template'))`;
  }
  return {
    name,
    appUrl: pgUrl(pg, 'pospay_app', pg.appPassword, name),
    authUrl: pgUrl(pg, 'pospay_auth', pg.authPassword, name),
    ownerUrl: pgUrl(pg, pg.ownerUser, pg.ownerPassword, name),
    drop: async () => {
      await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await maintenance.end();
    },
  };
}
