import { AuthUserNotFoundError, type AuthDatabase } from '@pospay/db';
import { eq } from 'drizzle-orm';

type NavigationStyle = 'A' | 'B' | 'C';

/** العمليات تستخدم اتصال الاعتماد الحالي؛ لا يخرج العميل ولا تُفتح أي وصلة لكل طلب. */
export function createMyPreferences(database: AuthDatabase) {
  const { db, schema: { user } } = database;
  return {
    read: async (userId: string): Promise<NavigationStyle | null> => {
      const [row] = await db.select({ navStyle: user.navStyle }).from(user).where(eq(user.id, userId));
      return storedStyle(row?.navStyle);
    },
    write: async (userId: string, navStyle: NavigationStyle | null): Promise<NavigationStyle | null> => {
      const [row] = await db.update(user).set({ navStyle }).where(eq(user.id, userId))
        .returning({ navStyle: user.navStyle });
      if (row === undefined) throw new AuthUserNotFoundError();
      return storedStyle(row.navStyle);
    },
  };
}

function storedStyle(value: unknown): NavigationStyle | null {
  return value === 'A' || value === 'B' || value === 'C' ? value : null;
}

export type MyPreferences = ReturnType<typeof createMyPreferences>;
