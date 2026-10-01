import { readStoredToken } from '@/device/model/credentials';
import { setDeviceTokenReader } from '@/shared/api/device-auth';

export function bindDeviceAuth(): void {
  setDeviceTokenReader(readStoredToken);
}
