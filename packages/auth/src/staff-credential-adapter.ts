import type { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { StaffUserAccess } from './staff-access-users.ts';

/** تحديث الحساب لا يحمل userId؛ الفلتر هو مصدر هوية الهدف قبل تغيير كلمة السر. */
export function staffCredentialAdapter(
  factory: ReturnType<typeof drizzleAdapter>,
  staffUsers: StaffUserAccess,
): ReturnType<typeof drizzleAdapter> {
  return (options) => {
    const adapter = factory(options);
    return {
      ...adapter,
      update: async (input) => {
        if (input.model === 'account') {
          const target = await adapter.findOne<{ userId: string }>({
            model: 'account',
            where: input.where,
          });
          if (target !== null && (await staffUsers.isStaffUser(target.userId)))
            throw new Error('STAFF_USER_CREDENTIAL_REFUSED');
        }
        return adapter.update(input);
      },
      updateMany: async (input) => {
        if (input.model === 'account') {
          const targets = await adapter.findMany<{ userId: string }>({
            model: 'account',
            where: input.where,
          });
          for (const target of targets) {
            if (await staffUsers.isStaffUser(target.userId))
              throw new Error('STAFF_USER_CREDENTIAL_REFUSED');
          }
        }
        return adapter.updateMany(input);
      },
    };
  };
}
