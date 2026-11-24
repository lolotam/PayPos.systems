import type { Provider } from '@nestjs/common';
import type { AuthService } from '@pospay/auth';
import { MEMBER_INVITATION_LINK_TTL_MS } from '@pospay/auth';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import { AUTH_SERVICE } from '../../shared/session.guard.ts';
import { createGrantInvalidator } from './persistence/grant-invalidator.ts';
import { createMemberAccounts } from './persistence/member-accounts.adapter.ts';
import { createMemberInvitationTransactions } from './persistence/member-invitation-transactions.ts';
import { createInvitationRateLimiter } from './persistence/redis-invitation-rates.ts';
import {
  MEMBER_PASSWORD_STATE,
  type MemberPasswordState,
} from './http/member-invitations.controller.ts';
import {
  INVITATION_RATE_LIMITER,
  type InvitationRateLimiter,
} from './ports/member-invitations.port.ts';
import { InviteMember } from './use-cases/invite-member/invite-member.ts';
import { ReissueMemberInvitation } from './use-cases/reissue-member-invitation/reissue-member-invitation.ts';

/**
 * ربط مسار دعوة العضو (G1): الحساب على pospay_auth والصفوف على pospay_app، والبوابة مقفولة
 * لحد ما الشريحة تتدمج (plan §1.1). فصلته عن identity.module عشان حدود الـ 300/400 سطر.
 *
 * @param database الـ tenant wrappers لو التطبيق فيه داتابيز
 * @param ids      مولّد الـ UUID v7
 * @param redis    عميل Redis للحدّ، لو التطبيق فيه Redis
 * @param adminOrigin أصل لوحة الإدارة اللي رابط تعيين كلمة المرور بيتبني عليه
 * @returns الـ providers اللي بتتضاف على الموديول بعد حارس الجلسة
 */
export function memberInvitationProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis: Redis | undefined,
  adminOrigin: string | undefined,
  clock: { now(): Date },
): Provider[] {
  const redirectTo = adminOrigin === undefined ? undefined : `${adminOrigin}/set-password`;
  const limiter = redis === undefined ? null : createInvitationRateLimiter(redis);
  return [
    { provide: INVITATION_RATE_LIMITER, useValue: limiter },
    passwordStateProvider(),
    inviteMemberProvider(database, ids, redis, redirectTo, clock),
    reissueMemberInvitationProvider(database, ids, redirectTo, clock),
  ];
}

// حالة كلمة المرور بتتقري من جداول الهوية وقت عرض قائمة الدعوات؛ ناقص الاعتماد بيرجّع null.
function passwordStateProvider(): Provider {
  return {
    provide: MEMBER_PASSWORD_STATE,
    useFactory: (auth: AuthService | null): MemberPasswordState | null =>
      auth === null
        ? null
        : async (userId) => auth.members.hasPassword(userId),
    inject: [AUTH_SERVICE],
  };
}

// ناقص داتابيز أو اعتماد أو Redis أو أصل اللوحة معناه المسار مش جاهز: بيرد 503 من الكنترولر.
function inviteMemberProvider(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis: Redis | undefined,
  redirectTo: string | undefined,
  clock: { now(): Date },
): Provider {
  return {
    provide: InviteMember,
    useFactory: (auth: AuthService | null, rateLimiter: InvitationRateLimiter | null) => {
      if (
        database === undefined ||
        auth === null ||
        rateLimiter === null ||
        redirectTo === undefined
      ) {
        return null;
      }
      return new InviteMember({
        transactions: createMemberInvitationTransactions(database, ids),
        accounts: createMemberAccounts(auth),
        limiter: rateLimiter,
        invalidator: createGrantInvalidator(redis),
        clock,
        ids,
        redirectTo,
        linkLifetimeMs: MEMBER_INVITATION_LINK_TTL_MS,
      });
    },
    inject: [AUTH_SERVICE, INVITATION_RATE_LIMITER],
  };
}

// نفس شروط المسار الأول، من غير إبطال الكاش لأن إعادة الإصدار ما بتغيّرش العضوية.
function reissueMemberInvitationProvider(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redirectTo: string | undefined,
  clock: { now(): Date },
): Provider {
  return {
    provide: ReissueMemberInvitation,
    useFactory: (auth: AuthService | null, rateLimiter: InvitationRateLimiter | null) => {
      if (
        database === undefined ||
        auth === null ||
        rateLimiter === null ||
        redirectTo === undefined
      ) {
        return null;
      }
      return new ReissueMemberInvitation({
        transactions: createMemberInvitationTransactions(database, ids),
        accounts: createMemberAccounts(auth),
        limiter: rateLimiter,
        clock,
        redirectTo,
        linkLifetimeMs: MEMBER_INVITATION_LINK_TTL_MS,
      });
    },
    inject: [AUTH_SERVICE, INVITATION_RATE_LIMITER],
  };
}
