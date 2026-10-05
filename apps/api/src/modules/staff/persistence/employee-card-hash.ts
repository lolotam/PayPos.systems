import { createHmac } from 'node:crypto';
import { normalizeCardCode } from '../domain/employee-card.ts';

// المفتاح مشتق من سر الخادم الثابت، لا سر QR اليومي الذي يبطل الكروت عند دورانه.
export function createEmployeeCardHash(serverSecret: string) {
  if (serverSecret.length < 32) throw new Error('CARD_KEY_UNAVAILABLE');
  const key = createHmac('sha256', serverSecret).update('pospay:employee-card:key:v1').digest();
  return (companyId: string, code: string): string =>
    createHmac('sha256', key)
      .update(JSON.stringify(['pospay:employee-card:v1', companyId, normalizeCardCode(code)]))
      .digest('hex');
}
