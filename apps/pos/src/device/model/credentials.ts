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

export interface ClaimSnapshot {
  device_id: string;
  claim_secret: string;
}

// رد المطالبة ممكن يوصل متأخر — بعد «البدء من جديد» أو بعد ما تاب تاني سجّل الجهاز من الأول — ووقتها ما ينفعش
// يلمس البيانات اللي حلّت محله. الفحص والكتابة في نفس transaction بتاعة IndexedDB، فمفيش تاب يدخل بينهم.
export function applyIfRegistration(
  claim: ClaimSnapshot,
  write: (current: DeviceCredentialRow) => Promise<void>,
): Promise<boolean> {
  return enqueueWrite(() =>
    deviceDb.transaction('rw', deviceDb.credentials, async () => {
      const current = await deviceDb.credentials.get(CURRENT_DEVICE);
      if (current?.device_id !== claim.device_id || current.claim_secret !== claim.claim_secret) {
        return false;
      }
      await write(current);
      return true;
    }),
  );
}

export function clearIfToken(token: string): Promise<boolean> {
  return enqueueWrite(() =>
    deviceDb.transaction('rw', deviceDb.credentials, async () => {
      const current = await deviceDb.credentials.get(CURRENT_DEVICE);
      if (current?.device_token !== token) return false;
      await deviceDb.credentials.delete(CURRENT_DEVICE);
      return true;
    }),
  );
}
