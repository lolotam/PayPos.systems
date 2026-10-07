import { createHmac } from 'node:crypto';
import { normalizeCardCode } from '../domain/employee-card.ts';

const labels = {
  lookup: 'pospay:employee-card:lookup:v1',
  issue: 'pospay:employee-card:issue-idempotency:v1',
  revoke: 'pospay:employee-card:revoke-idempotency:v1',
  clock: 'pospay:employee-card:clock-idempotency:v1',
  // علامة اكتمال المحاولة فقط. البصمة غير المفتاحية فيها الكود، فلا تصل Redis إلا داخل هذا HMAC.
  'issue-attempt': 'pospay:employee-card:issue-attempt:v1',
  // علامة اكتمال المسح فقط. نفس السبب: بصمة الطلب تحمل الكود، وهاش بلا مفتاح يُخمَّن من Redis.
  'scan-attempt': 'pospay:employee-card:scan-attempt:v1',
} as const;

// المفتاح الفرعي يصل جاهزاً من جذر التركيب؛ الفصل بين الأغراض يمنع إعادة استخدام بصمة كاعتماد.
export function createEmployeeCardHash(cardKey: Buffer) {
  if (!Buffer.isBuffer(cardKey) || cardKey.length !== 32) throw new Error('CARD_KEY_UNAVAILABLE');
  const key = Buffer.from(cardKey);
  return (companyId: string, value: string, purpose: keyof typeof labels = 'lookup'): string =>
    createHmac('sha256', key)
      .update(
        JSON.stringify([
          labels[purpose],
          companyId,
          purpose === 'lookup' ? normalizeCardCode(value) : value,
        ]),
      )
      .digest('hex');
}

export type EmployeeCardHash = ReturnType<typeof createEmployeeCardHash>;
