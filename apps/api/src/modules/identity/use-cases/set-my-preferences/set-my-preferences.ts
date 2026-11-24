import type { MyPreferencesResponse, SetMyPreferencesInput } from '@pospay/contracts';

import type { MyPreferencesWriter } from '../../ports/my-preferences.port.ts';

/** يغيّر تفضيل العرض الشخصي؛ هوية الحساب تأتي من المتصل المحقّق خارج جسم الطلب. */
export class SetMyPreferences {
  constructor(private readonly writer: MyPreferencesWriter) {}

  async execute(userId: string, input: SetMyPreferencesInput): Promise<MyPreferencesResponse> {
    return { navStyle: await this.writer.write(userId, input.navStyle) };
  }
}
