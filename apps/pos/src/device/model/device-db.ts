import Dexie, { type Table } from 'dexie';

export interface DeviceCredentialRow {
  id: 'current';
  company_id: string;
  device_id: string;
  claim_secret: string | null;
  device_token: string | null;
}

// بيانات اعتماد الجهاز في IndexedDB لأن الـ PWA مالهاش httpOnly cookie للجهاز.
class DeviceDatabase extends Dexie {
  credentials!: Table<DeviceCredentialRow, 'current'>;

  constructor() {
    super('pospay-pos');
    this.version(1).stores({ credentials: 'id' });
  }
}

export const deviceDb = new DeviceDatabase();

export const CURRENT_DEVICE = 'current' as const;
