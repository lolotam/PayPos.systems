import type { MyPreferencesResponse } from '@pospay/contracts';

import type { MyPreferencesReader } from '../ports/my-preferences.port.ts';

/** شاشة المظهر ودخول الإدارة يقرآن الحساب من واجهة الاعتماد دون أي بيانات شركة. */
export async function myPreferences(reader: MyPreferencesReader, userId: string): Promise<MyPreferencesResponse> {
  return { navStyle: await reader.read(userId) };
}
