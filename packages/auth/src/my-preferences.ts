import type { AuthDatabase } from '@pospay/db';

type NavigationStyle = 'A' | 'B' | 'C';

/** العمليات تستخدم اتصال الاعتماد الحالي؛ لا يخرج العميل ولا تُفتح أي وصلة لكل طلب. */
export function createMyPreferences(database: AuthDatabase) {
  return {
    read: async (userId: string): Promise<NavigationStyle | null> => {
      return storedStyle(await database.readNavStyle(userId));
    },
    write: async (userId: string, navStyle: NavigationStyle | null): Promise<NavigationStyle | null> => {
      return storedStyle(await database.writeNavStyle(userId, navStyle));
    },
  };
}

function storedStyle(value: unknown): NavigationStyle | null {
  return value === 'A' || value === 'B' || value === 'C' ? value : null;
}

export type MyPreferences = ReturnType<typeof createMyPreferences>;
