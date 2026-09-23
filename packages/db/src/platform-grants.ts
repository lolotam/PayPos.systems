import postgres from 'postgres';

import type { IdGenerator } from './with-tenant.ts';

/**
 * طلب منح أو سحب صلاحية منصة من سكريبت الـ operator.
 */
export interface PlatformGrantRequest {
  readonly email: string;
  /** صلاحية منصة من الـ catalog (بتخلص بـ ':platform'). */
  readonly permission: string;
  /** اسم الـ operator اللي شغّل السكريبت — بيتسجل في الـ grant وفي السجل. */
  readonly operator: string;
  readonly expiresAt?: Date;
}

/**
 * نتيجة المنح أو السحب: الـ grant اللي اتأثر، أو إن مفيش حاجة اتغيرت.
 */
export type PlatformGrantOutcome =
  | { readonly status: 'granted' | 'revoked'; readonly grantId: string; readonly userId: string }
  | { readonly status: 'already-granted' | 'not-granted'; readonly userId: string };

// Refused with a message that names the email the operator typed — it is their own input, never a customer's.
async function userIdOf(tx: postgres.TransactionSql, email: string): Promise<string> {
  const [row] = await tx<
    { id: string }[]
  >`SELECT id FROM "user" WHERE email = ${email.toLowerCase()}`;
  if (row === undefined) {
    throw Object.assign(
      new Error('no user with that email — run pnpm platform:create-user first'),
      {
        name: 'OperatorInputError',
      },
    );
  }
  return row.id;
}

/**
 * بيدّي صلاحية منصة ليوزر موجود، ويكتب سطر في platform_audit_log في نفس الـ transaction — مفيش grant من غير سجل.
 * لو فيه grant ساري لنفس الصلاحية مبيعملش حاجة (السكريبت ممكن يتعاد).
 *
 * @param ownerUrl اتصال كـ pospay_owner — مفيش role runtime يقدر يكتب على platform_grants
 * @param request  الإيميل والصلاحية واسم الـ operator وتاريخ الانتهاء لو فيه
 * @param ids      مولّد الـ UUID v7
 * @returns granted مع الـ id، أو already-granted
 */
export async function grantPlatformPermission(
  ownerUrl: string,
  request: PlatformGrantRequest,
  ids: IdGenerator,
): Promise<PlatformGrantOutcome> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    return await sql.begin(async (tx) => {
      const userId = await userIdOf(tx, request.email);
      // An expired grant is still the "active" row for the unique index; it is closed (and audited) first, so a
      // regrant replaces it instead of reporting already-granted while authorization refuses.
      const expired = await tx<{ id: string }[]>`
        UPDATE platform_grants SET revoked_at = now(), revoked_by = ${request.operator}
        WHERE user_id = ${userId} AND permission = ${request.permission}
          AND revoked_at IS NULL AND expires_at <= now()
        RETURNING id`;
      for (const { id } of expired) {
        await tx`
          INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
          VALUES (${ids.newId()}, ${request.operator}, 'grant.revoked', ${userId},
                  ${tx.json({ grant_id: id, permission: request.permission, reason: 'expired' })})`;
      }
      const grantId = ids.newId();
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO platform_grants (id, user_id, permission, granted_by, expires_at)
        VALUES (${grantId}, ${userId}, ${request.permission}, ${request.operator}, ${request.expiresAt ?? null})
        ON CONFLICT (user_id, permission) WHERE revoked_at IS NULL DO NOTHING
        RETURNING id`;
      if (inserted.length === 0) return { status: 'already-granted', userId } as const;
      await tx`
        INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
        VALUES (${ids.newId()}, ${request.operator}, 'grant.granted', ${userId},
                ${tx.json({ grant_id: grantId, permission: request.permission, expires_at: request.expiresAt?.toISOString() ?? null })})`;
      return { status: 'granted', grantId, userId } as const;
    });
  } finally {
    await sql.end();
  }
}

/**
 * بيسحب صلاحية منصة سارية: الصف بيفضل موجود ومعاه مين ومتى، والسحب بيتسجل في نفس الـ transaction.
 *
 * @param ownerUrl اتصال كـ pospay_owner
 * @param request  الإيميل والصلاحية واسم الـ operator
 * @param ids      مولّد الـ UUID v7 لسطر السجل
 * @returns revoked مع الـ id، أو not-granted لو مكانش فيه grant ساري
 */
export async function revokePlatformPermission(
  ownerUrl: string,
  request: Omit<PlatformGrantRequest, 'expiresAt'>,
  ids: IdGenerator,
): Promise<PlatformGrantOutcome> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    return await sql.begin(async (tx) => {
      const userId = await userIdOf(tx, request.email);
      const [row] = await tx<{ id: string }[]>`
        UPDATE platform_grants SET revoked_at = now(), revoked_by = ${request.operator}
        WHERE user_id = ${userId} AND permission = ${request.permission} AND revoked_at IS NULL
        RETURNING id`;
      if (row === undefined) return { status: 'not-granted', userId } as const;
      await tx`
        INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
        VALUES (${ids.newId()}, ${request.operator}, 'grant.revoked', ${userId},
                ${tx.json({ grant_id: row.id, permission: request.permission })})`;
      return { status: 'revoked', grantId: row.id, userId } as const;
    });
  } finally {
    await sql.end();
  }
}
