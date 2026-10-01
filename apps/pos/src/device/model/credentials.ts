import { deviceDb, CURRENT_DEVICE, type DeviceCredentialRow } from './device-db';
import { enqueueWrite } from './write-queue';

export interface StoredRegistration {
  company_id: string;
  device_id: string;
  claim_secret: string;
}

export function readCredentials(): Promise<DeviceCredentialRow | undefined> {
  return deviceDb.credentials.get(CURRENT_DEVICE);
}

export function saveRegistration(input: StoredRegistration): Promise<void> {
  return enqueueWrite(async () => {
    await deviceDb.credentials.put({
      id: CURRENT_DEVICE,
      company_id: input.company_id,
      device_id: input.device_id,
      claim_secret: input.claim_secret,
      device_token: null,
    });
  });
}

export function clearCredentials(): Promise<void> {
  return enqueueWrite(() => deviceDb.credentials.delete(CURRENT_DEVICE));
}

export async function readStoredToken(): Promise<string | null> {
  const row = await deviceDb.credentials.get(CURRENT_DEVICE);
  const token = row?.device_token;
  if (token === undefined || token === null || token.length === 0) return null;
  return token;
}
