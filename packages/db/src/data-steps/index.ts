import { systemUuidV7 } from '@pospay/ids';
import type postgres from 'postgres';

import { createDatabase } from '../client.ts';
import { rekeyEmployeeNameKeys } from './employee-name-keys.ts';

/** يربط علامات الترحيل بخطوات بيانات معزولة، ويغلق اتصال التطبيق حتى عند فشل الخطوة. */
export function migrationDataSteps(ownerUrl: string, appPassword: string) {
  return {
    'employee-name-keys': async (owner: postgres.Sql): Promise<void> => {
      const url = new URL(ownerUrl);
      url.username = 'pospay_app';
      url.password = appPassword;
      const app = createDatabase({ url: url.toString(), ids: systemUuidV7(), maxConnections: 1 });
      try {
        const { companies, read, updated } = await rekeyEmployeeNameKeys(owner, app);
        console.log(`companies=${companies} read=${read} updated=${updated}`);
      } finally {
        await app.close();
      }
    },
  };
}
