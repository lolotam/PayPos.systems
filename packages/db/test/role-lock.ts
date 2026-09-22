import postgres from 'postgres';
import { inject } from 'vitest';

import { pgUrl } from './pg-env.ts';

const ROLE_TEST_LOCK = 'pospay:test-cluster-roles';

/**
 * الـ roles على مستوى الـ cluster، فاختبار بيغيّر عضوية role بيأثر على أي تشغيلة تانية شغالة في نفس الوقت.
 * اللي بيغيّر بياخد الـ lock حصري، واللي بيتأكد بس بياخده مشترك — على داتابيز الصيانة
 * عشان الـ lock يبقى واحد لكل التشغيلات.
 *
 * @param mode 'exclusive' للاختبار اللي بيغيّر، 'shared' للي بيقرا بس
 * @param fn   الاختبار نفسه
 * @returns نتيجة fn
 */
export async function withClusterRoleLock<T>(
  mode: 'shared' | 'exclusive',
  fn: () => Promise<T>,
): Promise<T> {
  const pg = inject('pg');
  const sql = postgres(pgUrl(pg, pg.ownerUser, pg.ownerPassword, 'postgres'), {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    if (mode === 'exclusive') await sql`SELECT pg_advisory_lock(hashtext(${ROLE_TEST_LOCK}))`;
    else await sql`SELECT pg_advisory_lock_shared(hashtext(${ROLE_TEST_LOCK}))`;
    return await fn();
  } finally {
    await sql.end();
  }
}
