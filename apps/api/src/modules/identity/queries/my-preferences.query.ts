import type { MyPreferencesResponse } from '@pospay/contracts';

/** شكل قارئ التفضيل كما تحتاجه الشاشة؛ قيمته القيمة المربوطة من واجهة الاعتماد بلا أي بيانات شركة. */
export type MyPreferencesReader = {
  read(userId: string): Promise<MyPreferencesResponse['navStyle']>;
};

/** شاشة المظهر ودخول الإدارة يقرآن الحساب من واجهة الاعتماد دون أي بيانات شركة. */
export async function myPreferences(reader: MyPreferencesReader, userId: string): Promise<MyPreferencesResponse> {
  return { navStyle: await reader.read(userId) };
}
